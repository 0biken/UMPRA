import { isUuid } from "@/lib/ids";
import type { TournamentDetailsResponse, TournamentSummaryItem } from "@/lib/tournament-view";
export type { TournamentSummaryItem } from "@/lib/tournament-view";
import { ExtractionSchema } from "@/server/agent/vision/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { audit, listTournamentActivity } from "@/server/audit";
import {
  db,
  disputes,
  entries,
  matches,
  submissions,
  tournaments,
  users,
  type DbOrTx,
  type PayoutSplitBps,
} from "@/server/db";
import { getLivePrizePoolCents } from "@/server/paypal/orders";
import { getTournamentLedger } from "@/server/paypal/payouts";
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
  return txOrDb.transaction(async tx => {
  const [tournament] = await tx
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1).for("update");

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

  const [updated] = await tx
    .update(tournaments)
    .set({
      title: merged.title,
      game: merged.game,
      entryFeeCents: merged.entryFeeCents,
      payoutSplit: merged.payoutSplit,
    })
    .where(eq(tournaments.id, tournamentId))
    .returning();

  await audit(tx, { tournamentId, actorType: "user", actorId: hostId, action: "tournament.terms_updated", payload: { entryFeeCents: updated.entryFeeCents, payoutSplit: updated.payoutSplit } });
  return updated;
  });
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
      .limit(1).for("update");

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

export async function listTournaments(
  filter?: {
    hostId?: string;
    onlyOpenOrActive?: boolean;
  },
  txOrDb: DbOrTx = db
): Promise<TournamentSummaryItem[]> {
  const rows = filter?.hostId
    ? await txOrDb
        .select()
        .from(tournaments)
        .where(eq(tournaments.hostId, filter.hostId))
        .orderBy(desc(tournaments.createdAt))
    : await txOrDb
        .select()
        .from(tournaments)
        .orderBy(desc(tournaments.createdAt));

  const filtered = filter?.onlyOpenOrActive
    ? rows.filter((r) => r.state !== "draft")
    : rows;

  const result: TournamentSummaryItem[] = [];
  for (const t of filtered) {
    const tEntries = await txOrDb
      .select()
      .from(entries)
      .where(eq(entries.tournamentId, t.id));
    const paidCount = tEntries.filter((e) => e.status === "paid").length;
    const pendingCount = tEntries.filter((e) => e.status === "pending").length;
    const prizePoolCents = await getLivePrizePoolCents(t.id, txOrDb);

    result.push({
      id: t.id,
      hostId: t.hostId,
      title: t.title,
      game: t.game,
      format: t.format,
      slots: t.slots,
      entryFeeCents: t.entryFeeCents,
      currency: t.currency,
      payoutSplit: t.payoutSplit,
      state: t.state,
      paidCount,
      pendingCount,
      prizePoolCents,
      maxPrizePoolCents: t.entryFeeCents * t.slots,
      createdAt: t.createdAt.toISOString(),
    });
  }

  return result;
}

export async function getTournamentDetails(
  tournamentId: string,
  txOrDb: DbOrTx = db,
  viewerId?: string
): Promise<TournamentDetailsResponse> {
  if (!isUuid(tournamentId)) throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  const [t] = await txOrDb.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
  if (!t) throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  const isHost = viewerId === t.hostId;
  if (t.state === "draft" && !isHost) throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  const [host] = await txOrDb.select({ displayName: users.displayName }).from(users).where(eq(users.id, t.hostId));
  const es = await txOrDb.select().from(entries).where(eq(entries.tournamentId, t.id)).orderBy(asc(entries.createdAt));
  const ms = await txOrDb.select().from(matches).where(eq(matches.tournamentId, t.id)).orderBy(asc(matches.round), asc(matches.position));
  const ids = ms.map(m => m.id);
  const subs = ids.length ? await txOrDb.select().from(submissions).where(inArray(submissions.matchId, ids)) : [];
  const ds = ids.length ? await txOrDb.select().from(disputes).where(inArray(disputes.matchId, ids)).orderBy(desc(disputes.createdAt)) : [];
  const tag = (id: string | null) => es.find(e => e.playerId === id)?.gamertag ?? null;
  const final = ms.find(m => m.round === 3 && m.status === "confirmed");
  const runnerUpId = final ? (final.winnerId === final.playerAId ? final.playerBId : final.playerAId) : null;
  const ledger = await getTournamentLedger(t.id);
  const activity = await listTournamentActivity(t.id, txOrDb);
  const recipientRows = isHost && es.length ? await txOrDb.select({ id: users.id, paypalEmail: users.paypalEmail }).from(users).where(inArray(users.id, es.map(e => e.playerId))) : [];
  const rows = ledger.rows.map(r => ({ id: r.id, direction: r.direction, gamertag: r.gamertag, description: r.label, amountCents: r.amountCents, status: r.status, paypalId: isHost ? r.referenceId : null, createdAt: r.createdAt.toISOString() }));
  return {
    tournament: { id: t.id, hostId: t.hostId, hostDisplayName: host?.displayName ?? "Host", title: t.title, game: t.game, slots: t.slots, entryFeeCents: t.entryFeeCents, currency: t.currency, payoutSplit: t.payoutSplit, state: t.state, championId: t.championId, championGamertag: tag(t.championId), runnerUpId, runnerUpGamertag: tag(runnerUpId), cancelReason: t.cancelReason },
    prizePoolCents: await getLivePrizePoolCents(t.id, txOrDb), maxPrizePoolCents: t.entryFeeCents * t.slots,
    paidCount: es.filter(e => e.status === "paid").length, pendingCount: es.filter(e => e.status === "pending").length,
    entries: es.map(e => ({ id: e.id, playerId: e.playerId, gamertag: e.gamertag, status: e.status, simulated: e.simulated, createdAt: e.createdAt.toISOString(), ...(isHost ? { paypalEmail: recipientRows.find(u => u.id === e.playerId)?.paypalEmail ?? null } : {}) })),
    matches: ms.map(m => {
      const ss = subs.filter(s => s.matchId === m.id);
      const d = ds.find(d => d.matchId === m.id);
      const canReadEvidence = isHost || viewerId === m.playerAId || viewerId === m.playerBId;
      // A host ruling selects a winner, not a score. Never display conflicting scores as confirmed.
      const ext = m.status === "confirmed" && !d ? ss.map(s => ExtractionSchema.safeParse(s.extractedJson)).find(x => x.success)?.data : null;
      const normalize = (name: string | null | undefined) => name?.replace(/\s+/g, "").toLowerCase();
      const aHome = ext && normalize(ext.home.name) === normalize(tag(m.playerAId)) && normalize(ext.away.name) === normalize(tag(m.playerBId));
      const aAway = ext && normalize(ext.away.name) === normalize(tag(m.playerAId)) && normalize(ext.home.name) === normalize(tag(m.playerBId));
      const resolvedId = d?.resolution === "winner_a" ? m.playerAId : d?.resolution === "winner_b" ? m.playerBId : null;
      return {
        id: m.id, round: m.round, position: m.position, playerAId: m.playerAId, playerAGamertag: tag(m.playerAId), playerASimulated: es.find(e => e.playerId === m.playerAId)?.simulated ?? false,
        playerBId: m.playerBId, playerBGamertag: tag(m.playerBId), playerBSimulated: es.find(e => e.playerId === m.playerBId)?.simulated ?? false,
        scoreA: aHome ? ext!.home.score : aAway ? ext!.away.score : null, scoreB: aHome ? ext!.away.score : aAway ? ext!.home.score : null,
        winnerId: m.winnerId, winnerGamertag: tag(m.winnerId), status: m.status, nextMatchId: m.nextMatchId, nextSlot: m.nextSlot, awaitingSince: m.awaitingSince?.toISOString() ?? null,
        submissions: ss.map(s => ({ id: s.id, playerId: s.playerId, gamertag: tag(s.playerId) ?? "Player", extractionStatus: s.extractionStatus, confidence: canReadEvidence ? s.confidence : null, extractedJson: canReadEvidence ? ExtractionSchema.safeParse(s.extractedJson).data ?? null : null, attempts: s.attempts, createdAt: s.createdAt.toISOString() })),
        dispute: d ? { id: d.id, reason: isHost ? d.reason : "host_review", summary: isHost ? d.summary : null, status: d.status, resolvedWinnerId: resolvedId, resolvedWinnerGamertag: tag(resolvedId), resolutionNote: isHost ? d.resolutionNote : null } : null,
      };
    }),
    ledger: { entriesIn: rows.filter(r => r.direction === "in"), refundsOut: rows.filter(r => r.direction === "refund"), payoutsOut: rows.filter(r => r.direction === "out"), totalCapturedCents: ledger.totalInCents, totalRefundedCents: ledger.totalRefundedCents, netPoolCents: ledger.totalInCents - ledger.totalRefundedCents, totalPaidOutCents: ledger.totalOutCents, netBalanceCents: ledger.netHeldCents },
    activity: activity.map(a => ({ id: a.id, tournamentId: a.tournamentId, actorType: a.actorType, actorId: a.actorId, action: a.action, sentence: a.sentence, createdAt: a.createdAt.toISOString() })),
  };
}
