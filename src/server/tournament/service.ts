import { and, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { audit } from "@/server/audit";
import {
  db,
  entries,
  tournaments,
  type DbOrTx,
  type PayoutSplitBps,
} from "@/server/db";
import { assertTransition } from "./state-machine";
import { validateTournamentConfig } from "./config";

export async function createTournament(
  hostId: string,
  configInput: unknown,
  txOrDb: DbOrTx = db
): Promise<typeof tournaments.$inferSelect> {
  const config = validateTournamentConfig(configInput);

  const [created] = await txOrDb
    .insert(tournaments)
    .values({
      hostId,
      title: config.title,
      game: config.game,
      format: config.format,
      slots: config.slots,
      entryFeeCents: config.entryFeeCents,
      currency: config.currency,
      payoutSplit: config.payoutSplit,
      state: "draft",
      registrationClosesAt: config.registrationClosesAt ?? null,
    })
    .returning();

  await audit(txOrDb, {
    tournamentId: created.id,
    actorType: "user",
    actorId: hostId,
    action: "tournament.created",
    payload: {
      title: created.title,
      entryFeeCents: created.entryFeeCents,
      payoutSplit: created.payoutSplit,
    },
    dedupeKey: `create:${created.id}`,
  });

  return created;
}

/**
 * Updates tournament config (title, game, entryFeeCents, payoutSplit) ONLY while in `draft` state.
 * Guardrail #6: Payout split and entry fee are frozen once the tournament leaves `draft` (`open` or later).
 */
export async function updateTournamentTerms(
  hostId: string,
  tournamentId: string,
  patchInput: {
    title?: string;
    game?: string;
    entryFeeCents?: number;
    payoutSplit?: PayoutSplitBps;
  },
  txOrDb: DbOrTx = db
): Promise<typeof tournaments.$inferSelect> {
  const [tournament] = await txOrDb
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) {
    throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  }
  if (tournament.hostId !== hostId) {
    throw new AppError(
      "FORBIDDEN",
      "Only the tournament host can edit this tournament.",
      403
    );
  }
  if (tournament.state !== "draft") {
    throw new AppError(
      "INVALID_TRANSITION",
      "Terms lock once registration opens. Payout split and entry fee cannot be edited.",
      409
    );
  }

  const merged = validateTournamentConfig({
    title: patchInput.title ?? tournament.title,
    game: patchInput.game ?? tournament.game,
    format: tournament.format,
    slots: tournament.slots,
    entryFeeCents: patchInput.entryFeeCents ?? tournament.entryFeeCents,
    currency: tournament.currency,
    payoutSplit: patchInput.payoutSplit ?? tournament.payoutSplit,
    registrationClosesAt: tournament.registrationClosesAt,
  });

  const [updated] = await txOrDb
    .update(tournaments)
    .set({
      title: merged.title,
      game: merged.game,
      entryFeeCents: merged.entryFeeCents,
      payoutSplit: merged.payoutSplit,
    })
    .where(eq(tournaments.id, tournamentId))
    .returning();

  return updated;
}

export async function openTournament(
  hostId: string,
  tournamentId: string
): Promise<typeof tournaments.$inferSelect> {
  return db.transaction(async (tx) => {
    const [tournament] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);

    if (!tournament) {
      throw new AppError("NOT_FOUND", "Tournament not found.", 404);
    }
    if (tournament.hostId !== hostId) {
      throw new AppError(
        "FORBIDDEN",
        "Only the tournament host can open registration.",
        403
      );
    }

    // Re-validate config before opening
    validateTournamentConfig({
      title: tournament.title,
      game: tournament.game,
      format: tournament.format,
      slots: tournament.slots,
      entryFeeCents: tournament.entryFeeCents,
      currency: tournament.currency,
      payoutSplit: tournament.payoutSplit,
      registrationClosesAt: tournament.registrationClosesAt,
    });

    assertTransition(tournament.state, "open");

    const [updated] = await tx
      .update(tournaments)
      .set({ state: "open" })
      .where(eq(tournaments.id, tournamentId))
      .returning();

    await audit(tx, {
      tournamentId,
      actorType: "user",
      actorId: hostId,
      action: "tournament.opened",
      payload: {
        entryFeeCents: updated.entryFeeCents,
        payoutSplit: updated.payoutSplit,
      },
      dedupeKey: `open:${tournamentId}`,
    });

    return updated;
  });
}

export async function cancelTournamentByHost(
  hostId: string,
  tournamentId: string,
  reason = "Cancelled by host"
): Promise<typeof tournaments.$inferSelect> {
  return db.transaction(async (tx) => {
    const [tournament] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);

    if (!tournament) {
      throw new AppError("NOT_FOUND", "Tournament not found.", 404);
    }
    if (tournament.hostId !== hostId) {
      throw new AppError(
        "FORBIDDEN",
        "Only the tournament host can cancel this tournament.",
        403
      );
    }

    assertTransition(tournament.state, "cancelled");

    // Mark any pending entries as cancelled so slots free immediately
    await tx
      .update(entries)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(entries.tournamentId, tournamentId),
          eq(entries.status, "pending")
        )
      );

    const [updated] = await tx
      .update(tournaments)
      .set({
        state: "cancelled",
        cancelReason: reason,
      })
      .where(eq(tournaments.id, tournamentId))
      .returning();

    await audit(tx, {
      tournamentId,
      actorType: "user",
      actorId: hostId,
      action: "tournament.cancelled",
      payload: { reason },
      dedupeKey: `cancel:${tournamentId}`,
    });

    return updated;
  });
}
