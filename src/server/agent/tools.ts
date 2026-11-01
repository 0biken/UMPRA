import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/audit";
import {
  db,
  entries,
  matches,
  submissions,
  tournaments,
  type DbOrTx,
} from "@/server/db";
import { assertTransition } from "@/server/tournament/state-machine";
import {
  advanceWinner,
  generateBracketForTournament,
  getRoundName,
} from "@/server/tournament/bracket";
import { openMatchDispute } from "@/server/tournament/disputes";
import {
  draftTournamentPayouts,
  sendPayoutBatch,
  syncTournamentPayoutStatuses,
} from "@/server/paypal/payouts";
import { issueRefundForPayment } from "@/server/paypal/refunds";
import { getPayPalClient, type PayPalClient } from "@/server/paypal/client";
import { getStorageProvider, type StorageProvider } from "@/server/storage";
import { getVisionProvider } from "./vision/anthropic";
import {
  runVisionExtractionWithRetries,
  type VisionProvider,
} from "./vision/provider";
import type { Extraction } from "./vision/schema";
import {
  evaluateSubmissions,
  type EvaluationDecision,
  type EvaluationTimeouts,
} from "./evaluate";
import type { DisputeFacts } from "./summarize-dispute";

export interface AgentToolContext {
  txOrDb?: DbOrTx;
  paypal?: PayPalClient;
  vision?: VisionProvider;
  storage?: StorageProvider;
  now?: Date;
}

const uuidSchema = z.string().uuid();

export const agentTools = {
  /**
   * `tournament.lock`: Transitions tournament `open -> locked` once 8 paid entries exist.
   */
  async lockTournament(
    rawInput: { tournamentId: string },
    ctx: AgentToolContext = {}
  ) {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(rawInput);
    const txOrDb = ctx.txOrDb ?? db;
    const now = ctx.now ?? new Date();

    const [t] = await txOrDb
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);

    if (!t) {
      throw new AppError("NOT_FOUND", "Tournament not found.", 404);
    }

    if (t.state === "locked" || t.state === "in_progress") {
      return t;
    }

    const paidEntries = await txOrDb
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.tournamentId, tournamentId),
          eq(entries.status, "paid")
        )
      );

    if (paidEntries.length < t.slots) {
      throw new AppError(
        "INVALID_TRANSITION",
        `Cannot lock tournament with ${paidEntries.length}/${t.slots} paid entries.`,
        409
      );
    }

    assertTransition(t.state, "locked");

    const [updated] = await txOrDb
      .update(tournaments)
      .set({
        state: "locked",
        lockedAt: now,
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();

    await audit(txOrDb, {
      tournamentId,
      actorType: "agent",
      action: "tournament.locked",
      payload: { paidCount: paidEntries.length },
      dedupeKey: `lock:${tournamentId}`,
    });

    return updated;
  },

  /**
   * `bracket.generate`: Generates 7 seeded single-elimination matches and transitions `locked -> in_progress`.
   */
  async generateBracket(
    rawInput: { tournamentId: string; seed?: number },
    ctx: AgentToolContext = {}
  ) {
    const parsed = z
      .object({
        tournamentId: uuidSchema,
        seed: z.number().int().optional(),
      })
      .parse(rawInput);

    const txOrDb = ctx.txOrDb ?? db;
    const now = ctx.now ?? new Date();

    const [t] = await txOrDb
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, parsed.tournamentId))
      .limit(1);

    if (!t) {
      throw new AppError("NOT_FOUND", "Tournament not found.", 404);
    }

    const paidEntries = await txOrDb
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.tournamentId, parsed.tournamentId),
          eq(entries.status, "paid")
        )
      )
      .orderBy(asc(entries.createdAt), asc(entries.id));

    if (paidEntries.length !== 8) {
      throw new AppError(
        "VALIDATION",
        `Bracket generation requires 8 paid entries (found ${paidEntries.length}).`,
        400
      );
    }

    const seed =
      parsed.seed ??
      t.bracketSeed ??
      Math.floor(100000 + Math.random() * 900000);

    const playerIds = paidEntries.map((e) => e.playerId);
    const gamertagByPlayer = new Map(
      paidEntries.map((e) => [e.playerId, e.gamertag])
    );

    const createdMatches = await generateBracketForTournament(
      txOrDb,
      parsed.tournamentId,
      playerIds,
      seed,
      now
    );

    if (t.state === "locked") {
      assertTransition("locked", "in_progress");
      await txOrDb
        .update(tournaments)
        .set({ state: "in_progress", bracketSeed: seed })
        .where(eq(tournaments.id, parsed.tournamentId));
    }

    await audit(txOrDb, {
      tournamentId: parsed.tournamentId,
      actorType: "agent",
      action: "bracket.generated",
      payload: { seed, matchCount: createdMatches.length },
      dedupeKey: `bracket:${parsed.tournamentId}`,
    });

    // Audit each Round 1 match opening
    for (const m of createdMatches.filter((m) => m.round === 1)) {
      const playerA = gamertagByPlayer.get(m.playerAId ?? "") ?? "Player A";
      const playerB = gamertagByPlayer.get(m.playerBId ?? "") ?? "Player B";
      await audit(txOrDb, {
        tournamentId: parsed.tournamentId,
        actorType: "agent",
        action: "match.opened",
        payload: {
          matchId: m.id,
          round: m.round,
          position: m.position,
          playerA,
          playerB,
        },
        dedupeKey: `match-open:${m.id}`,
      });
    }

    return createdMatches;
  },

  /**
   * `bracket.advance`: Places confirmed match winner into next match slot idempotently.
   */
  async advanceBracket(
    rawInput: { matchId: string; tournamentId: string; winnerGamertag: string },
    ctx: AgentToolContext = {}
  ) {
    const parsed = z
      .object({
        matchId: uuidSchema,
        tournamentId: uuidSchema,
        winnerGamertag: z.string(),
      })
      .parse(rawInput);

    const txOrDb = ctx.txOrDb ?? db;
    const now = ctx.now ?? new Date();

    const result = await advanceWinner(parsed.matchId, txOrDb, now);

    if (result.nextRound) {
      await audit(txOrDb, {
        tournamentId: parsed.tournamentId,
        actorType: "agent",
        action: "bracket.advanced",
        payload: {
          matchId: parsed.matchId,
          nextMatchId: result.nextMatchId,
          winner: parsed.winnerGamertag,
          roundName: getRoundName(result.nextRound),
        },
        dedupeKey: `advance:${parsed.matchId}`,
      });
    }

    if (result.nextMatchActivated && result.nextMatchId) {
      const [nextMatch] = await txOrDb
        .select()
        .from(matches)
        .where(eq(matches.id, result.nextMatchId))
        .limit(1);

      if (nextMatch?.playerAId && nextMatch?.playerBId) {
        const tEntries = await txOrDb
          .select()
          .from(entries)
          .where(eq(entries.tournamentId, parsed.tournamentId));
        const tagMap = new Map(tEntries.map((e) => [e.playerId, e.gamertag]));

        await audit(txOrDb, {
          tournamentId: parsed.tournamentId,
          actorType: "agent",
          action: "match.opened",
          payload: {
            matchId: nextMatch.id,
            round: nextMatch.round,
            position: nextMatch.position,
            playerA: tagMap.get(nextMatch.playerAId) ?? "Player A",
            playerB: tagMap.get(nextMatch.playerBId) ?? "Player B",
          },
          dedupeKey: `match-open:${nextMatch.id}`,
        });
      }
    }

    return result;
  },

  /**
   * `vision.extractScore`: Reads a pending submission screenshot via the VisionProvider and persists extraction.
   */
  async extractScore(
    rawInput: {
      submissionId: string;
      tournamentId: string;
      gamertag: string;
      expectedGamertags: [string, string];
    },
    ctx: AgentToolContext = {}
  ) {
    const parsed = z
      .object({
        submissionId: uuidSchema,
        tournamentId: uuidSchema,
        gamertag: z.string(),
        expectedGamertags: z.tuple([z.string(), z.string()]),
      })
      .parse(rawInput);

    const vision = ctx.vision ?? getVisionProvider();
    const storage = ctx.storage ?? getStorageProvider();

    const [sub] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, parsed.submissionId))
      .limit(1);

    if (!sub) {
      throw new AppError("NOT_FOUND", "Submission not found.", 404);
    }

    if (sub.extractionStatus !== "pending") {
      return {
        extractionStatus: sub.extractionStatus,
        extractedJson: (sub.extractedJson as Extraction | null) ?? null,
        confidence: sub.confidence ?? null,
      };
    }

    const file = await storage.downloadScreenshot(sub.screenshotPath);
    const result = await runVisionExtractionWithRetries(
      vision,
      {
        imageBytes: file.bytes,
        mimeType: file.mimeType,
        expectedGamertags: parsed.expectedGamertags,
        screenshotPath: sub.screenshotPath,
      },
      { priorAttempts: sub.attempts }
    );

    await db
      .update(submissions)
      .set({
        extractionStatus: result.extractionStatus,
        extractedJson: result.extractedJson,
        confidence: result.confidence,
        attempts: result.attemptsUsed,
      })
      .where(eq(submissions.id, sub.id));

    if (result.extractionStatus !== "pending") {
      const ext = result.extractedJson;
      const scoreSummary =
        ext && ext.home.score !== null && ext.away.score !== null
          ? `${ext.home.name ?? "?"} ${ext.home.score} - ${ext.away.score} ${ext.away.name ?? "?"}`
          : "unreadable";

      await audit(db, {
        tournamentId: parsed.tournamentId,
        actorType: "agent",
        action: "evidence.extracted",
        payload: {
          submissionId: sub.id,
          matchId: sub.matchId,
          gamertag: parsed.gamertag,
          score: scoreSummary,
          confidence: result.confidence ?? 0,
          status: result.extractionStatus,
        },
        dedupeKey: `extract:${sub.id}:${sub.screenshotPath}`,
      });
    }

    return result;
  },

  /**
   * `evidence.evaluate`: Pure agreement rule evaluation.
   */
  evaluateEvidence(
    input: {
      match: Parameters<typeof evaluateSubmissions>[0];
      submissions: Parameters<typeof evaluateSubmissions>[1];
      players: Parameters<typeof evaluateSubmissions>[2];
      now?: Date;
      timeouts?: EvaluationTimeouts;
    }
  ): EvaluationDecision {
    return evaluateSubmissions(
      input.match,
      input.submissions,
      input.players,
      input.now,
      input.timeouts
    );
  },

  /**
   * `dispute.open`: Opens a dispute on a match and writes an agent audit row.
   */
  async openDispute(
    rawInput: {
      matchId: string;
      tournamentId: string;
      facts: DisputeFacts;
    },
    ctx: AgentToolContext = {}
  ) {
    const txOrDb = ctx.txOrDb ?? db;
    return openMatchDispute(txOrDb, rawInput);
  },

  /**
   * `payout.draft`: Computes deterministic payout amounts and creates `drafted` payout rows.
   */
  async draftPayout(
    rawInput: { tournamentId: string },
    ctx: AgentToolContext = {}
  ) {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(rawInput);
    const txOrDb = ctx.txOrDb ?? db;
    return draftTournamentPayouts(tournamentId, txOrDb);
  },

  /**
   * `paypal.getOrder`
   */
  async paypalGetOrder(
    rawInput: { orderId: string; tournamentId?: string },
    ctx: AgentToolContext = {}
  ) {
    const { orderId, tournamentId } = z
      .object({ orderId: z.string().min(1), tournamentId: uuidSchema.optional() })
      .parse(rawInput);
    const paypal = ctx.paypal ?? getPayPalClient();
    const res = await paypal.getOrder(orderId);
    await audit(ctx.txOrDb ?? db, {
      tournamentId: tournamentId ?? null,
      actorType: "agent",
      action: "paypal.order_checked",
      payload: { orderId, status: res.status },
      dedupeKey: `pp-get-order:${orderId}:${res.status}`,
    });
    return res;
  },

  /**
   * `paypal.captureOrder`
   */
  async paypalCaptureOrder(
    rawInput: { orderId: string; requestId: string; tournamentId?: string },
    ctx: AgentToolContext = {}
  ) {
    const { orderId, requestId, tournamentId } = z
      .object({
        orderId: z.string().min(1),
        requestId: z.string().min(1),
        tournamentId: uuidSchema.optional(),
      })
      .parse(rawInput);
    const paypal = ctx.paypal ?? getPayPalClient();
    const res = await paypal.captureOrder(orderId, requestId);
    await audit(ctx.txOrDb ?? db, {
      tournamentId: tournamentId ?? null,
      actorType: "agent",
      action: "paypal.order_captured",
      payload: { orderId, captureId: res.captureId },
      dedupeKey: `pp-cap-order:${requestId}`,
    });
    return res;
  },

  /**
   * `paypal.refundCapture`
   */
  async paypalRefundCapture(
    rawInput: { paymentId: string },
    ctx: AgentToolContext = {}
  ) {
    const { paymentId } = z.object({ paymentId: uuidSchema }).parse(rawInput);
    return issueRefundForPayment(paymentId, {
      paypal: ctx.paypal,
      now: ctx.now,
    });
  },

  /**
   * `paypal.getPayoutBatch`
   */
  async paypalGetPayoutBatch(
    rawInput: { tournamentId: string },
    ctx: AgentToolContext = {}
  ) {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(rawInput);
    return syncTournamentPayoutStatuses(tournamentId, { paypal: ctx.paypal });
  },

  /**
   * `paypal.createPayoutBatch`: Sends winners' money via PayPal Payouts.
   * REFUSES unless every payout row is `approved` by a host (`T-050 AC`, `EC-O4`).
   */
  async paypalCreatePayoutBatch(
    rawInput: { tournamentId: string },
    ctx: AgentToolContext = {}
  ) {
    const { tournamentId } = z
      .object({ tournamentId: uuidSchema })
      .parse(rawInput);
    return sendPayoutBatch(tournamentId, { paypal: ctx.paypal });
  },
};
