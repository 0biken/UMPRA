import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/audit";
import {
  db,
  disputes,
  entries,
  matches,
  tournaments,
  users,
  type DbOrTx,
} from "@/server/db";
import { assertMatchTransition } from "./state-machine";
import { advanceWinner, getRoundName } from "./bracket";
import {
  generateDisputeSummary,
  type DisputeFacts,
} from "@/server/agent/summarize-dispute";

export const resolveDisputeSchema = z.object({
  resolution: z.enum(["winner_a", "winner_b"], {
    error: "Choose either winner_a or winner_b.",
  }),
  note: z
    .string()
    .trim()
    .max(300, "Resolution note must be at most 300 characters.")
    .optional(),
});

/**
 * Opens a dispute on an `awaiting_results` match with an LLM-written or template summary (T-044).
 * Enforces `one_open_dispute_per_match` idempotently.
 */
export async function openMatchDispute(
  txOrDb: DbOrTx,
  input: {
    matchId: string;
    tournamentId: string;
    facts: DisputeFacts;
    summaryOverride?: string;
  }
): Promise<typeof disputes.$inferSelect> {
  const [existingOpen] = await txOrDb
    .select()
    .from(disputes)
    .where(
      and(eq(disputes.matchId, input.matchId), eq(disputes.status, "open"))
    )
    .limit(1);

  if (existingOpen) {
    return existingOpen;
  }

  const summary =
    input.summaryOverride ?? (await generateDisputeSummary(input.facts));

  const [match] = await txOrDb
    .select()
    .from(matches)
    .where(eq(matches.id, input.matchId))
    .limit(1);

  if (!match) {
    throw new AppError("NOT_FOUND", "Match not found.", 404);
  }

  if (match.status === "awaiting_results") {
    assertMatchTransition(match.status, "disputed");
    await txOrDb
      .update(matches)
      .set({ status: "disputed" })
      .where(eq(matches.id, match.id));
  }

  const inserted = await txOrDb
    .insert(disputes)
    .values({
      matchId: match.id,
      reason: input.facts.reason,
      summary,
      status: "open",
    })
    .onConflictDoNothing()
    .returning();

  const disputeRow =
    inserted[0] ??
    (
      await txOrDb
        .select()
        .from(disputes)
        .where(
          and(eq(disputes.matchId, match.id), eq(disputes.status, "open"))
        )
        .limit(1)
    )[0];

  await audit(txOrDb, {
    tournamentId: input.tournamentId,
    actorType: "agent",
    action: "dispute.opened",
    payload: {
      matchId: match.id,
      disputeId: disputeRow.id,
      reason: input.facts.reason,
      playerA: input.facts.playerA.gamertag,
      playerB: input.facts.playerB.gamertag,
      summary,
    },
    dedupeKey: `dispute:${match.id}`,
  });

  return disputeRow;
}

/**
 * Host resolves a dispute by choosing `winner_a` or `winner_b` plus an optional note (T-045).
 * Only the tournament's host can resolve (`EC-A1`). Resolving twice is a safe no-op (`EC-R12`).
 */
export async function resolveDisputeByHost(
  hostId: string,
  disputeId: string,
  rawInput: unknown,
  options?: { now?: Date }
): Promise<{
  dispute: typeof disputes.$inferSelect;
  alreadyResolved: boolean;
  tournamentId: string;
}> {
  const parsed = resolveDisputeSchema.safeParse(rawInput);
  if (!parsed.success) {
    const firstMsg =
      parsed.error.issues[0]?.message ?? "Select a winner to resolve the dispute.";
    throw new AppError("VALIDATION", firstMsg, 400);
  }

  const now = options?.now ?? new Date();
  const { resolution, note } = parsed.data;

  const [dispute] = await db
    .select()
    .from(disputes)
    .where(eq(disputes.id, disputeId))
    .limit(1);

  if (!dispute) {
    throw new AppError("NOT_FOUND", "Dispute not found.", 404);
  }

  const [match] = await db
    .select()
    .from(matches)
    .where(eq(matches.id, dispute.matchId))
    .limit(1);

  if (!match) {
    throw new AppError("NOT_FOUND", "Match not found.", 404);
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, match.tournamentId))
    .limit(1);

  if (!tournament) {
    throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  }

  if (tournament.hostId !== hostId) {
    throw new AppError(
      "FORBIDDEN",
      "Only the host who created this tournament can resolve its disputes.",
      403
    );
  }

  // Idempotency (EC-R12): resolving twice is a no-op
  if (dispute.status === "resolved") {
    return {
      dispute,
      alreadyResolved: true,
      tournamentId: tournament.id,
    };
  }

  const winnerId =
    resolution === "winner_a" ? match.playerAId : match.playerBId;
  if (!winnerId) {
    throw new AppError(
      "VALIDATION",
      "Selected winner slot has no assigned player.",
      400
    );
  }

  const [hostUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, hostId))
    .limit(1);

  const [winnerEntry] = await db
    .select()
    .from(entries)
    .where(
      and(
        eq(entries.tournamentId, tournament.id),
        eq(entries.playerId, winnerId)
      )
    )
    .limit(1);

  const updatedDispute = await db.transaction(async (tx) => {
    const [freshDispute] = await tx
      .select()
      .from(disputes)
      .where(eq(disputes.id, dispute.id))
      .limit(1);

    if (freshDispute.status === "resolved") {
      return freshDispute;
    }

    const [resolved] = await tx
      .update(disputes)
      .set({
        status: "resolved",
        resolvedBy: hostId,
        resolution,
        resolutionNote: note ?? null,
        resolvedAt: now,
      })
      .where(eq(disputes.id, dispute.id))
      .returning();

    const [freshMatch] = await tx
      .select()
      .from(matches)
      .where(eq(matches.id, match.id))
      .limit(1);

    if (freshMatch && freshMatch.status !== "confirmed") {
      assertMatchTransition(freshMatch.status, "confirmed");
      await tx
        .update(matches)
        .set({
          status: "confirmed",
          winnerId,
        })
        .where(eq(matches.id, match.id));
    }

    const adv = await advanceWinner(match.id, tx, now);

    await audit(tx, {
      tournamentId: tournament.id,
      actorType: "user",
      actorId: hostId,
      action: "dispute.resolved",
      payload: {
        disputeId: dispute.id,
        matchId: match.id,
        host: hostUser?.displayName ?? "Host",
        winner: winnerEntry?.gamertag ?? "Winner",
        winnerId,
        resolution,
        note: note ?? null,
      },
      dedupeKey: `resolve:${dispute.id}`,
    });

    if (adv.nextRound) {
      await audit(tx, {
        tournamentId: tournament.id,
        actorType: "agent",
        action: "bracket.advanced",
        payload: {
          matchId: match.id,
          nextMatchId: adv.nextMatchId,
          winner: winnerEntry?.gamertag ?? "Winner",
          winnerId,
          roundName: getRoundName(adv.nextRound),
        },
        dedupeKey: `advance:${match.id}`,
      });
    }

    return resolved;
  });

  return {
    dispute: updatedDispute,
    alreadyResolved: false,
    tournamentId: tournament.id,
  };
}
