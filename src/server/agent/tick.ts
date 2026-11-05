import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import {
  db,
  disputes,
  entries,
  matches,
  payouts,
  submissions,
  tournaments,
} from "@/server/db";
import {
  assertMatchTransition,
  assertTransition,
} from "@/server/tournament/state-machine";
import { expireStalePendingEntries } from "@/server/paypal/orders";
import {
  cancelAndRefundTournament,
  refundTournamentPayments,
} from "@/server/paypal/refunds";
import { reprocessUnprocessedWebhookEvents } from "@/server/paypal/webhooks";
import type { PayPalClient } from "@/server/paypal/client";
import type { StorageProvider } from "@/server/storage";
import type { VisionProvider } from "./vision/provider";
import type { Extraction } from "./vision/schema";
import { agentTools } from "./tools";
import { buildDisputeFallbackSummary, generateDisputeSummary, type DisputeFacts } from "./summarize-dispute";
import type { DisputeReason } from "./evaluate";

type MatchRow = typeof matches.$inferSelect;
type SubmissionRow = typeof submissions.$inferSelect;

function factsForMatch(m: MatchRow, subs: SubmissionRow[], tags: Map<string, string>, reason: DisputeReason): DisputeFacts {
  const player = (id: string | null, fallback: string) => {
    const sub = subs.find(s => s.playerId === id);
    return { gamertag: tags.get(id ?? "") ?? fallback, submitted: Boolean(sub),
      extractionStatus: sub?.extractionStatus, extracted: (sub?.extractedJson as Extraction | null) ?? null };
  };
  return { reason, playerA: player(m.playerAId, "Player A"), playerB: player(m.playerBId, "Player B") };
}

function evidenceVersion(m: MatchRow, subs: SubmissionRow[], facts: DisputeFacts): string {
  return JSON.stringify([m.playerAId, m.playerBId, m.awaitingSince, facts,
    [...subs].sort((a, b) => a.id.localeCompare(b.id)).map(s => [s.id, s.screenshotPath, s.extractionStatus, s.attempts, s.createdAt, s.extractedJson])]);
}

function decide(m: MatchRow, subs: SubmissionRow[], tags: Map<string, string>, now: Date) {
  return agentTools.evaluateEvidence({ match: { ...m, playerAId: m.playerAId!, playerBId: m.playerBId! }, submissions: subs.map(s => ({ ...s, extractedJson: (s.extractedJson as Extraction | null) ?? null })),
    players: { playerA: { id: m.playerAId!, gamertag: tags.get(m.playerAId!) ?? "Player A" },
      playerB: { id: m.playerBId!, gamertag: tags.get(m.playerBId!) ?? "Player B" } }, now,
    timeouts: { matchTimeoutMin: env.MATCH_TIMEOUT_MIN, secondSubmissionTimeoutMin: env.SECOND_SUBMISSION_TIMEOUT_MIN } });
}

/** Slow summary generation never holds a transaction, row lock, or advisory lock. */
async function prepareDisputeSummaries(tournamentId: string, now: Date) {
  const prepared = new Map<string, { version: string; summary: string }>();
  const rows = await db.select().from(matches).where(and(eq(matches.tournamentId, tournamentId), eq(matches.status, "awaiting_results")));
  const players = await db.select().from(entries).where(eq(entries.tournamentId, tournamentId));
  const tags = new Map(players.map(e => [e.playerId, e.gamertag]));
  for (const match of rows) {
    if (!match.playerAId || !match.playerBId) continue;
    const subs = await db.select().from(submissions).where(eq(submissions.matchId, match.id));
    const decision = decide(match, subs, tags, now);
    if (decision.outcome !== "dispute") continue;
    const facts = factsForMatch(match, subs, tags, decision.reason);
    prepared.set(match.id, { version: evidenceVersion(match, subs, facts), summary: await generateDisputeSummary(facts) });
  }
  return prepared;
}

export interface TickOptions {
  now?: Date;
  paypal?: PayPalClient;
  vision?: VisionProvider;
  storage?: StorageProvider;
  seedOverride?: number;
  /**
   * Optional test hook invoked between steps to simulate process crashes mid-tick (T-053, EC-R8).
   */
  onStepHook?: (step: string) => void | Promise<void>;
}

/**
 * Extracts any `pending` screenshot submissions for `tournamentId` outside of row locks
 * so network calls to the vision provider never hold DB locks (`05 §Tick`).
 */
async function extractPendingTournamentSubmissions(
  tournamentId: string,
  options?: TickOptions
): Promise<void> {
  const tMatches = await db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.tournamentId, tournamentId),
        eq(matches.status, "awaiting_results")
      )
    );

  if (tMatches.length === 0) return;

  const tEntries = await db
    .select()
    .from(entries)
    .where(eq(entries.tournamentId, tournamentId));
  const tagByPlayer = new Map(tEntries.map((e) => [e.playerId, e.gamertag]));

  for (const m of tMatches) {
    if (!m.playerAId || !m.playerBId) continue;
    const tagA = tagByPlayer.get(m.playerAId) ?? "Player A";
    const tagB = tagByPlayer.get(m.playerBId) ?? "Player B";

    const mSubs = await db
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.matchId, m.id),
          eq(submissions.extractionStatus, "pending")
        )
      );

    for (const sub of mSubs) {
      const submitterTag = tagByPlayer.get(sub.playerId) ?? "Player";
      await agentTools.extractScore(
        {
          submissionId: sub.id,
          tournamentId,
          gamertag: submitterTag,
          expectedGamertags: [tagA, tagB],
        },
        {
          vision: options?.vision,
          storage: options?.storage,
          now: options?.now,
        }
      );
    }
  }
}

/**
 * Autonomous umpire orchestrator (`05 §Tick`, T-051, T-053, T-054).
 * Uses `pg_advisory_xact_lock(hashtext(tournament_id::text))` inside transactions,
 * re-checks state before every mutation, and writes deduplicated audit rows.
 * Safe to call concurrently or N times in a row (`EC-R8`, `EC-R9`).
 */
export async function tick(
  tournamentId: string,
  options: TickOptions = {}
): Promise<void> {
  const now = options.now ?? new Date();
  const hook = options.onStepHook;

  // Step 1: Handle `open` and `locked` transitions inside an advisory-locked transaction
  const afterOpenOrLock = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${tournamentId}::text))`
    );

    const [t] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);

    if (!t) return null;

    if (t.state === "open") {
      // 1a. Expire pending entries older than 15 min
      await expireStalePendingEntries(tournamentId, { now, txOrDb: tx });

      const paidEntries = await tx
        .select()
        .from(entries)
        .where(
          and(
            eq(entries.tournamentId, tournamentId),
            eq(entries.status, "paid")
          )
        );

      // 1b. If registration_closes_at passed and paid < 8: auto-cancel (EC-P5)
      if (
        t.registrationClosesAt &&
        now.getTime() > t.registrationClosesAt.getTime() &&
        paidEntries.length < t.slots
      ) {
        return { action: "auto_cancel" as const, hostId: t.hostId };
      }

      // 1c. If paid == 8: transition open -> locked
      if (paidEntries.length === t.slots) {
        await agentTools.lockTournament(
          { tournamentId },
          { txOrDb: tx, now }
        );
        return { action: "locked" as const, hostId: t.hostId };
      }
    }

    return { action: "continue" as const, state: t.state, hostId: t.hostId };
  });

  if (!afterOpenOrLock) return;

  if (afterOpenOrLock.action === "auto_cancel") {
    await cancelAndRefundTournament(
      afterOpenOrLock.hostId,
      tournamentId,
      "Registration deadline passed before all 8 slots filled",
      {
        paypal: options.paypal,
        now,
        actorType: "agent",
        auditAction: "tournament.auto_cancelled",
      }
    );
    return;
  }

  if (hook) await hook("after_open_check");

  // Step 2: If `locked`, generate bracket and transition `locked -> in_progress`
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${tournamentId}::text))`
    );

    const [t] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);

    if (!t || t.state !== "locked") return;

    await agentTools.generateBracket(
      { tournamentId, seed: options.seedOverride },
      { txOrDb: tx, now }
    );
  });

  if (hook) await hook("after_bracket_generate");

  // Step 3: Before entering the match evaluation lock, extract any pending submissions via VisionProvider
  const [preEvalTournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (
    preEvalTournament &&
    (preEvalTournament.state === "in_progress" ||
      preEvalTournament.state === "results_pending")
  ) {
    await extractPendingTournamentSubmissions(tournamentId, options);
  }

  if (hook) await hook("after_vision_extract");

  const preparedSummaries = await prepareDisputeSummaries(tournamentId, now);

  // Step 4: Evaluate matches, open disputes, advance winners, and draft payouts inside advisory lock
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${tournamentId}::text))`
    );

    const [t] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);

    if (
      !t ||
      (t.state !== "in_progress" && t.state !== "results_pending")
    ) {
      return;
    }

    const tEntries = await tx
      .select()
      .from(entries)
      .where(eq(entries.tournamentId, tournamentId));
    const tagByPlayer = new Map(tEntries.map((e) => [e.playerId, e.gamertag]));

    let allMatches = await tx
      .select()
      .from(matches)
      .where(eq(matches.tournamentId, tournamentId))
      .orderBy(asc(matches.round), asc(matches.position)).for("update");

    // 4a. Activate any `waiting` match that now has both players assigned
    for (const m of allMatches) {
      if (m.status === "waiting" && m.playerAId && m.playerBId) {
        assertMatchTransition("waiting", "awaiting_results");
        await tx
          .update(matches)
          .set({ status: "awaiting_results", awaitingSince: now })
          .where(eq(matches.id, m.id));

        await audit(tx, {
          tournamentId,
          actorType: "agent",
          action: "match.opened",
          payload: {
            matchId: m.id,
            round: m.round,
            position: m.position,
            playerA: tagByPlayer.get(m.playerAId) ?? "Player A",
            playerB: tagByPlayer.get(m.playerBId) ?? "Player B",
          },
          dedupeKey: `match-open:${m.id}`,
        });
      }
    }

    allMatches = await tx
      .select()
      .from(matches)
      .where(eq(matches.tournamentId, tournamentId))
      .orderBy(asc(matches.round), asc(matches.position)).for("update");

    // 4b. Evaluate each `awaiting_results` match
    for (const m of allMatches.filter((m) => m.status === "awaiting_results")) {
      if (!m.playerAId || !m.playerBId) continue;

      const tagA = tagByPlayer.get(m.playerAId) ?? "Player A";
      const tagB = tagByPlayer.get(m.playerBId) ?? "Player B";

      const mSubs = await tx
        .select()
        .from(submissions)
        .where(eq(submissions.matchId, m.id))
        .orderBy(asc(submissions.createdAt));

      const decision = decide(m, mSubs, tagByPlayer, now);

      if (decision.outcome === "confirm") {
        assertMatchTransition(m.status, "confirmed");
        await tx
          .update(matches)
          .set({
            status: "confirmed",
            winnerId: decision.winnerId,
          })
          .where(eq(matches.id, m.id));

        const winnerTag =
          decision.winnerId === m.playerAId ? tagA : tagB;

        await audit(tx, {
          tournamentId,
          actorType: "agent",
          action: "match.confirmed",
          payload: {
            matchId: m.id,
            winnerId: decision.winnerId,
            winner: winnerTag,
            score: decision.formattedScore,
          },
          dedupeKey: `confirm:${m.id}`,
        });

        await agentTools.advanceBracket(
          {
            matchId: m.id,
            tournamentId,
            winnerGamertag: winnerTag,
          },
          { txOrDb: tx, now }
        );
      } else if (decision.outcome === "dispute") {
        const facts = factsForMatch(m, mSubs, tagByPlayer, decision.reason);
        const prepared = preparedSummaries.get(m.id);
        const summary = prepared?.version === evidenceVersion(m, mSubs, facts)
          ? prepared.summary : buildDisputeFallbackSummary(facts);
        await agentTools.openDispute(
          { matchId: m.id, tournamentId, facts, summaryOverride: summary },
          { txOrDb: tx, now }
        );
      }
    }

    // 4c. Reconcile any `disputed` match whose dispute row is already `resolved`
    allMatches = await tx
      .select()
      .from(matches)
      .where(eq(matches.tournamentId, tournamentId))
      .orderBy(asc(matches.round), asc(matches.position)).for("update");

    for (const m of allMatches) {
      if (m.status === "disputed") {
        const [resolvedDispute] = await tx
          .select()
          .from(disputes)
          .where(
            and(eq(disputes.matchId, m.id), eq(disputes.status, "resolved"))
          )
          .limit(1);

        if (resolvedDispute && resolvedDispute.resolution) {
          const winnerId =
            resolvedDispute.resolution === "winner_a"
              ? m.playerAId
              : m.playerBId;
          if (winnerId) {
            assertMatchTransition("disputed", "confirmed");
            await tx
              .update(matches)
              .set({ status: "confirmed", winnerId })
              .where(eq(matches.id, m.id));

            const winnerTag = tagByPlayer.get(winnerId) ?? "Winner";
            await agentTools.advanceBracket(
              {
                matchId: m.id,
                tournamentId,
                winnerGamertag: winnerTag,
              },
              { txOrDb: tx, now }
            );
          }
        }
      } else if (m.status === "confirmed" && m.winnerId && m.nextMatchId) {
        // Ensure any confirmed match whose winner wasn't yet advanced (e.g. crash recovery) is advanced
        const winnerTag = tagByPlayer.get(m.winnerId) ?? "Winner";
        await agentTools.advanceBracket(
          {
            matchId: m.id,
            tournamentId,
            winnerGamertag: winnerTag,
          },
          { txOrDb: tx, now }
        );
      }
    }

    // 4d. Check Final (Round 3) state transitions
    const [finalMatch] = await tx
      .select()
      .from(matches)
      .where(
        and(eq(matches.tournamentId, tournamentId), eq(matches.round, 3))
      )
      .limit(1);

    const [freshTournament] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);

    if (
      finalMatch &&
      finalMatch.playerAId &&
      finalMatch.playerBId &&
      freshTournament.state === "in_progress"
    ) {
      assertTransition("in_progress", "results_pending");
      await tx
        .update(tournaments)
        .set({ state: "results_pending" })
        .where(eq(tournaments.id, tournamentId));
    }

    if (finalMatch && finalMatch.status === "confirmed" && finalMatch.winnerId) {
      await agentTools.draftPayout({ tournamentId }, { txOrDb: tx, now });
    }
  });

  if (hook) await hook("after_matches_evaluate");

  // Step 5: Handle `confirmed` (payout sending/syncing) and `cancelled` (refund completion)
  const [postEvalTournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!postEvalTournament) return;

  if (postEvalTournament.state === "confirmed") {
    const payoutRows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.tournamentId, tournamentId));

    if (
      payoutRows.length > 0 &&
      payoutRows.every((r) => r.status === "approved" && r.approvedBy)
    ) {
      await agentTools.paypalCreatePayoutBatch(
        { tournamentId },
        { paypal: options.paypal, now }
      );
    } else if (payoutRows.some((r) => r.status === "submitted")) {
      await agentTools.paypalGetPayoutBatch(
        { tournamentId },
        { paypal: options.paypal, now }
      );
    }
  } else if (postEvalTournament.state === "cancelled") {
    await refundTournamentPayments(tournamentId, {
      paypal: options.paypal,
      now,
    });
  }
}

/**
 * Sweeps all active tournaments (`open`, `locked`, `in_progress`, `results_pending`, `confirmed`, `cancelled`)
 * plus reprocesses any out-of-order webhook events (T-052).
 */
export async function sweepActiveTournaments(
  options: TickOptions = {}
): Promise<{
  tickedTournamentIds: string[];
  reprocessedWebhooks: number;
}> {
  const reprocessedWebhooks = await reprocessUnprocessedWebhookEvents({
    paypal: options.paypal,
    now: options.now,
  });

  const active = await db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(
      inArray(tournaments.state, [
        "open",
        "locked",
        "in_progress",
        "results_pending",
        "confirmed",
        "cancelled",
      ])
    );

  const tickedTournamentIds: string[] = [];
  for (const row of active) {
    await tick(row.id, options);
    tickedTournamentIds.push(row.id);
  }

  return {
    tickedTournamentIds,
    reprocessedWebhooks,
  };
}
