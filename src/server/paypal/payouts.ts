import { and, asc, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { payoutBatchId, payoutItemId } from "@/lib/ids";
import { audit } from "@/server/audit";
import {
  db,
  disputes,
  entries,
  matches,
  payments,
  payouts,
  tournaments,
  users,
  type DbOrTx,
  type PayoutStatus,
} from "@/server/db";
import { computePayouts } from "@/server/tournament/payout-math";
import { assertTransition } from "@/server/tournament/state-machine";
import { getPayPalClient, type PayPalClient } from "./client";
import { getLivePrizePoolCents } from "./orders";

/**
 * Drafts the tournament payouts once the Round 3 final match is confirmed (T-054).
 * Amounts come deterministically from `computePayouts(poolCents, tournament.payoutSplit)`.
 * Blocks if any recipient lacks a PayPal email (`EC-O5`).
 */
export async function draftTournamentPayouts(
  tournamentId: string,
  txOrDb: DbOrTx = db
): Promise<Array<typeof payouts.$inferSelect>> {
  const [tournament] = await txOrDb
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) {
    throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  }

  const existingPayouts = await txOrDb
    .select()
    .from(payouts)
    .where(eq(payouts.tournamentId, tournamentId))
    .orderBy(asc(payouts.place));

  if (existingPayouts.length > 0) {
    return existingPayouts;
  }

  const [finalMatch] = await txOrDb
    .select()
    .from(matches)
    .where(
      and(eq(matches.tournamentId, tournamentId), eq(matches.round, 3))
    )
    .limit(1);

  if (
    !finalMatch ||
    finalMatch.status !== "confirmed" ||
    !finalMatch.winnerId ||
    !finalMatch.playerAId ||
    !finalMatch.playerBId
  ) {
    throw new AppError(
      "INVALID_TRANSITION",
      "Cannot draft payouts before the final match is confirmed.",
      409
    );
  }

  const championId = finalMatch.winnerId;
  const runnerUpId =
    finalMatch.playerAId === championId
      ? finalMatch.playerBId
      : finalMatch.playerAId;

  const recipientByPlace: Record<number, string> = {
    1: championId,
    2: runnerUpId,
  };

  // Read live prize pool from captured payments (fallback to 8 * entryFeeCents only when all entries are simulated demo bots without payment rows)
  let poolCents = await getLivePrizePoolCents(tournamentId, txOrDb);
  if (poolCents === 0) {
    const paidEntries = await txOrDb
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.tournamentId, tournamentId),
          eq(entries.status, "paid")
        )
      );
    if (
      paidEntries.length === tournament.slots &&
      paidEntries.every((e) => e.simulated)
    ) {
      poolCents = tournament.slots * tournament.entryFeeCents;
    }
  }

  if (poolCents <= 0) {
    throw new AppError(
      "VALIDATION",
      "Cannot draft payouts for a zero-balance prize pool.",
      400
    );
  }

  const computed = computePayouts(poolCents, tournament.payoutSplit);

  // Verify every recipient has a valid PayPal email before drafting (EC-O5)
  const auditItems: Array<{
    place: number;
    gamertag: string;
    amountCents: number;
  }> = [];

  for (const item of computed) {
    const recipientId = recipientByPlace[item.place];
    if (!recipientId) {
      throw new AppError(
        "VALIDATION",
        `No recipient found for place ${item.place}.`,
        400
      );
    }

    const [userRow] = await txOrDb
      .select()
      .from(users)
      .where(eq(users.id, recipientId))
      .limit(1);

    const [entryRow] = await txOrDb
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.tournamentId, tournamentId),
          eq(entries.playerId, recipientId)
        )
      )
      .limit(1);

    const gamertag = entryRow?.gamertag ?? userRow?.displayName ?? "Winner";

    if (
      !userRow?.paypalEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userRow.paypalEmail)
    ) {
      throw new AppError(
        "VALIDATION",
        `Cannot draft payout: ${gamertag} (place ${item.place}) has no valid PayPal email on file.`,
        400
      );
    }

    auditItems.push({
      place: item.place,
      gamertag,
      amountCents: item.amountCents,
    });
  }

  const batchSenderId = payoutBatchId(tournamentId);
  for (const item of computed) {
    const recipientId = recipientByPlace[item.place];
    await txOrDb
      .insert(payouts)
      .values({
        tournamentId,
        recipientId,
        place: item.place,
        amountCents: item.amountCents,
        status: "drafted",
        senderBatchId: batchSenderId,
        senderItemId: payoutItemId(tournamentId, item.place),
      })
      .onConflictDoNothing();
  }

  if (tournament.state === "in_progress") {
    assertTransition("in_progress", "results_pending");
    await txOrDb
      .update(tournaments)
      .set({ state: "results_pending" })
      .where(eq(tournaments.id, tournamentId));
  }

  const [freshTournament] = await txOrDb
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (freshTournament.state !== "confirmed" && freshTournament.state !== "paid") {
    assertTransition(freshTournament.state, "confirmed");
    await txOrDb
      .update(tournaments)
      .set({
        state: "confirmed",
        championId,
      })
      .where(eq(tournaments.id, tournamentId));
  }

  await audit(txOrDb, {
    tournamentId,
    actorType: "agent",
    action: "payout.drafted",
    payload: {
      poolCents,
      items: auditItems,
    },
    dedupeKey: `draft:${tournamentId}`,
  });

  return txOrDb
    .select()
    .from(payouts)
    .where(eq(payouts.tournamentId, tournamentId))
    .orderBy(asc(payouts.place));
}

/**
 * Code-level guardrail (`AGENTS.md` Guardrail #2, `04 §Payout flow`, `EC-O4`):
 * Sends the PayPal Payouts batch ONLY if every payout item to send has `status = 'approved'`
 * AND `approved_by` set. Throws `FORBIDDEN` if called without host approval.
 * Reuses the exact same `sender_batch_id` on retries (`EC-O2`).
 */
export async function sendPayoutBatch(
  tournamentId: string,
  options?: {
    paypal?: PayPalClient;
    onlyPayoutId?: string;
  }
): Promise<Array<typeof payouts.$inferSelect>> {
  const paypal = options?.paypal ?? getPayPalClient();

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) {
    throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  }

  const allRows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.tournamentId, tournamentId))
    .orderBy(asc(payouts.place));

  if (allRows.length === 0) {
    throw new AppError(
      "INVALID_TRANSITION",
      "No payouts have been drafted for this tournament.",
      409
    );
  }

  const targetRows = options?.onlyPayoutId
    ? allRows.filter((r) => r.id === options.onlyPayoutId)
    : allRows;

  // Idempotency: if all target rows are already submitted or succeeded, return current state
  if (
    targetRows.every(
      (r) => r.status === "submitted" || r.status === "succeeded"
    )
  ) {
    return allRows;
  }

  // Non-negotiable Guardrail #2: refuse unless every target row is `approved` with `approvedBy` set!
  for (const row of targetRows) {
    if (row.status !== "approved" || !row.approvedBy || !row.approvedAt) {
      throw new AppError(
        "FORBIDDEN",
        "Payout batch cannot be sent without explicit host confirmation.",
        403
      );
    }
  }

  const batchItems = [];
  for (const row of targetRows) {
    const [recipient] = await db
      .select()
      .from(users)
      .where(eq(users.id, row.recipientId))
      .limit(1);

    if (!recipient?.paypalEmail) {
      throw new AppError(
        "VALIDATION",
        `Recipient for place ${row.place} has no PayPal email.`,
        400
      );
    }

    batchItems.push({
      senderItemId: row.senderItemId,
      receiverEmail: recipient.paypalEmail,
      amountCents: row.amountCents,
      note: row.place === 1 ? "1st place" : `${row.place}nd place`,
    });
  }

  const senderBatchId = targetRows[0].senderBatchId;
  const createdBatch = await paypal.createPayoutBatch({
    senderBatchId,
    emailSubject: "You won on Umpra",
    emailMessage: `Your prize from ${tournament.title} has been paid.`,
    items: batchItems,
  });

  await db.transaction(async (tx) => {
    for (const row of targetRows) {
      await tx
        .update(payouts)
        .set({
          status: "submitted",
          paypalBatchId: createdBatch.batchId,
          error: null,
        })
        .where(eq(payouts.id, row.id));
    }

    await audit(tx, {
      tournamentId,
      actorType: "agent",
      action: "payout.submitted",
      payload: {
        senderBatchId,
        paypalBatchId: createdBatch.batchId,
        itemCount: targetRows.length,
      },
      dedupeKey: `payout-submitted:${senderBatchId}`,
    });
  });

  // Poll/sync batch item statuses immediately (in case sandbox or FakePayPal settled synchronously)
  await syncTournamentPayoutStatuses(tournamentId, { paypal });

  return db
    .select()
    .from(payouts)
    .where(eq(payouts.tournamentId, tournamentId))
    .orderBy(asc(payouts.place));
}

/**
 * Polls PayPal `GET /v1/payments/payouts/<batchId>` for any submitted items and updates
 * each item (`succeeded`, `failed`, `unclaimed`). Transitions tournament `confirmed -> paid`
 * ONLY when every payout row has `status = 'succeeded'` (T-063, EC-O3).
 */
export async function syncTournamentPayoutStatuses(
  tournamentId: string,
  options?: { paypal?: PayPalClient }
): Promise<{
  payouts: Array<typeof payouts.$inferSelect>;
  allSucceeded: boolean;
}> {
  const paypal = options?.paypal ?? getPayPalClient();

  const rows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.tournamentId, tournamentId))
    .orderBy(asc(payouts.place));

  const batchIds = Array.from(
    new Set(
      rows
        .filter((r) => r.paypalBatchId && r.status === "submitted")
        .map((r) => r.paypalBatchId!)
    )
  );

  for (const batchId of batchIds) {
    let details;
    try {
      details = await paypal.getPayoutBatch(batchId);
    } catch {
      continue;
    }

    for (const item of details.items) {
      const matchingRow = rows.find(
        (r) => r.senderItemId === item.senderItemId
      );
      if (!matchingRow) continue;

      let mappedStatus: PayoutStatus = "submitted";
      const txStatus = item.transactionStatus.toUpperCase();
      if (txStatus === "SUCCESS" || txStatus === "SUCCEEDED") {
        mappedStatus = "succeeded";
      } else if (txStatus === "UNCLAIMED" || txStatus === "ONHOLD") {
        mappedStatus = "unclaimed";
      } else if (
        txStatus === "FAILED" ||
        txStatus === "DENIED" ||
        txStatus === "BLOCKED" ||
        txStatus === "RETURNED"
      ) {
        mappedStatus = "failed";
      }

      if (mappedStatus === "submitted") continue;

      const errText =
        mappedStatus === "succeeded"
          ? null
          : item.errorMessage ??
            (mappedStatus === "unclaimed"
              ? "Recipient PayPal account is unclaimed."
              : "Payout item failed.");

      await db.transaction(async (tx) => {
        await tx
          .update(payouts)
          .set({
            status: mappedStatus,
            paypalItemId: item.payoutItemId,
            error: errText,
          })
          .where(eq(payouts.id, matchingRow.id));

        const [entryRow] = await tx
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.tournamentId, tournamentId),
              eq(entries.playerId, matchingRow.recipientId)
            )
          )
          .limit(1);

        const gamertag = entryRow?.gamertag ?? "Winner";

        if (mappedStatus === "succeeded") {
          await audit(tx, {
            tournamentId,
            actorType: "paypal",
            actorId: matchingRow.recipientId,
            action: "payout.item_succeeded",
            payload: {
              payoutId: matchingRow.id,
              place: matchingRow.place,
              gamertag,
              amountCents: matchingRow.amountCents,
              paypalItemId: item.payoutItemId,
            },
            dedupeKey: `payout-succeeded:${matchingRow.id}`,
          });
        } else {
          await audit(tx, {
            tournamentId,
            actorType: "paypal",
            actorId: matchingRow.recipientId,
            action: "payout.item_failed",
            payload: {
              payoutId: matchingRow.id,
              place: matchingRow.place,
              gamertag,
              amountCents: matchingRow.amountCents,
              error: errText,
            },
            dedupeKey: `payout-failed:${matchingRow.id}:${mappedStatus}`,
          });
        }
      });
    }
  }

  const updatedRows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.tournamentId, tournamentId))
    .orderBy(asc(payouts.place));

  const allSucceeded =
    updatedRows.length > 0 &&
    updatedRows.every((r) => r.status === "succeeded");

  if (allSucceeded) {
    await db.transaction(async (tx) => {
      const [t] = await tx
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);

      if (t && t.state === "confirmed") {
        assertTransition("confirmed", "paid");
        await tx
          .update(tournaments)
          .set({ state: "paid" })
          .where(eq(tournaments.id, tournamentId));
      }
    });
  }

  return { payouts: updatedRows, allSucceeded };
}

/**
 * Host confirms and releases the drafted payouts (T-061, EC-O1):
 * - Uses compare-and-set (`status = 'drafted' -> 'approved'`) inside a transaction.
 * - Double-clicks and refreshes return the same result without sending duplicate batches.
 */
export async function confirmAndSendTournamentPayout(
  hostId: string,
  tournamentId: string,
  options?: {
    paypal?: PayPalClient;
    now?: Date;
  }
): Promise<{
  alreadyConfirmed: boolean;
  payouts: Array<typeof payouts.$inferSelect>;
  tournamentState: string;
}> {
  const now = options?.now ?? new Date();

  const [tournament] = await db
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
      "Only the tournament host can confirm the payout.",
      403
    );
  }

  const [hostUser] = await db
    .select()
    .from(users)
    .where(eq(users.id, hostId))
    .limit(1);

  const casResult = await db.transaction(async (tx) => {
    const updated = await tx
      .update(payouts)
      .set({
        status: "approved",
        approvedBy: hostId,
        approvedAt: now,
      })
      .where(
        and(
          eq(payouts.tournamentId, tournamentId),
          eq(payouts.status, "drafted")
        )
      )
      .returning();

    if (updated.length > 0) {
      await audit(tx, {
        tournamentId,
        actorType: "user",
        actorId: hostId,
        action: "payout.approved",
        payload: {
          host: hostUser?.displayName ?? "Host",
          count: updated.length,
        },
        dedupeKey: `payout-approve:${tournamentId}`,
      });
      return { newlyApproved: true };
    }

    return { newlyApproved: false };
  });

  const currentRows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.tournamentId, tournamentId))
    .orderBy(asc(payouts.place));

  if (currentRows.length === 0) {
    throw new AppError(
      "INVALID_TRANSITION",
      "Payouts have not been drafted for this tournament yet.",
      409
    );
  }

  // If already submitted/succeeded, return current state without sending again (EC-O1)
  const needsSend = currentRows.some((r) => r.status === "approved");
  if (!casResult.newlyApproved && !needsSend) {
    const [freshT] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);
    return {
      alreadyConfirmed: true,
      payouts: currentRows,
      tournamentState: freshT.state,
    };
  }

  const sentRows = await sendPayoutBatch(tournamentId, {
    paypal: options?.paypal,
  });

  const [freshT] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  return {
    alreadyConfirmed: !casResult.newlyApproved,
    payouts: sentRows,
    tournamentState: freshT.state,
  };
}

/**
 * Retries a single failed or unclaimed payout item after host confirmation (T-063, EC-O3):
 * Assigns a new retry batch ID `payout-<tournamentId>-retry-<n>` and sends only that item.
 */
export async function retryFailedPayoutItem(
  hostId: string,
  tournamentId: string,
  payoutId: string,
  options?: {
    paypal?: PayPalClient;
    now?: Date;
  }
): Promise<Array<typeof payouts.$inferSelect>> {
  const now = options?.now ?? new Date();

  const [tournament] = await db
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
      "Only the tournament host can retry a failed payout.",
      403
    );
  }

  const [row] = await db
    .select()
    .from(payouts)
    .where(
      and(eq(payouts.id, payoutId), eq(payouts.tournamentId, tournamentId))
    )
    .limit(1);

  if (!row) {
    throw new AppError("NOT_FOUND", "Payout item not found.", 404);
  }
  if (row.status !== "failed" && row.status !== "unclaimed") {
    throw new AppError(
      "INVALID_TRANSITION",
      `Only failed or unclaimed payout items can be retried (current status: ${row.status}).`,
      409
    );
  }

  const retryMatch = row.senderBatchId.match(/-retry-(\d+)$/);
  const nextRetryNum = retryMatch ? Number.parseInt(retryMatch[1], 10) + 1 : 1;
  const newSenderBatchId = payoutBatchId(tournamentId, nextRetryNum);
  const newSenderItemId = `${payoutItemId(tournamentId, row.place)}-r${nextRetryNum}`;

  await db
    .update(payouts)
    .set({
      status: "approved",
      approvedBy: hostId,
      approvedAt: now,
      senderBatchId: newSenderBatchId,
      senderItemId: newSenderItemId,
      error: null,
    })
    .where(eq(payouts.id, row.id));

  return sendPayoutBatch(tournamentId, {
    paypal: options?.paypal,
    onlyPayoutId: row.id,
  });
}

export interface PayoutReviewData {
  tournamentId: string;
  tournamentTitle: string;
  tournamentState: string;
  poolCents: number;
  totalPayoutCents: number;
  recipients: Array<{
    id: string;
    place: number;
    recipientId: string;
    gamertag: string;
    displayName: string;
    paypalEmail: string | null;
    amountCents: number;
    status: PayoutStatus;
    senderBatchId: string;
    senderItemId: string;
    paypalBatchId: string | null;
    paypalItemId: string | null;
    error: string | null;
  }>;
  trail: {
    confirmedMatchesCount: number;
    resolvedDisputesCount: number;
  };
}

/**
 * Reads payout review data directly from DB rows (T-060).
 */
export async function getPayoutReviewData(
  tournamentId: string
): Promise<PayoutReviewData> {
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) {
    throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  }

  const payoutRows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.tournamentId, tournamentId))
    .orderBy(asc(payouts.place));

  const recipients: PayoutReviewData["recipients"] = [];
  for (const row of payoutRows) {
    const [u] = await db
      .select()
      .from(users)
      .where(eq(users.id, row.recipientId))
      .limit(1);

    const [e] = await db
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.tournamentId, tournamentId),
          eq(entries.playerId, row.recipientId)
        )
      )
      .limit(1);

    recipients.push({
      id: row.id,
      place: row.place,
      recipientId: row.recipientId,
      gamertag: e?.gamertag ?? u?.displayName ?? "Winner",
      displayName: u?.displayName ?? "Winner",
      paypalEmail: u?.paypalEmail ?? null,
      amountCents: row.amountCents,
      status: row.status,
      senderBatchId: row.senderBatchId,
      senderItemId: row.senderItemId,
      paypalBatchId: row.paypalBatchId ?? null,
      paypalItemId: row.paypalItemId ?? null,
      error: row.error ?? null,
    });
  }

  const allMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.tournamentId, tournamentId));

  const confirmedMatchesCount = allMatches.filter(
    (m) => m.status === "confirmed"
  ).length;

  let resolvedDisputesCount = 0;
  for (const m of allMatches) {
    const mDisputes = await db
      .select({ status: disputes.status })
      .from(disputes)
      .where(eq(disputes.matchId, m.id));
    resolvedDisputesCount += mDisputes.filter(
      (d) => d.status === "resolved"
    ).length;
  }

  const totalPayoutCents = recipients.reduce(
    (sum, r) => sum + r.amountCents,
    0
  );
  const livePool = await getLivePrizePoolCents(tournamentId);
  const poolCents = livePool > 0 ? livePool : totalPayoutCents;

  return {
    tournamentId: tournament.id,
    tournamentTitle: tournament.title,
    tournamentState: tournament.state,
    poolCents,
    totalPayoutCents,
    recipients,
    trail: {
      confirmedMatchesCount,
      resolvedDisputesCount,
    },
  };
}

export interface LedgerEntryRow {
  id: string;
  direction: "in" | "refund" | "out";
  label: string;
  gamertag: string;
  amountCents: number;
  status: string;
  referenceId: string | null;
  createdAt: Date;
}

export interface TournamentLedger {
  rows: LedgerEntryRow[];
  totalInCents: number;
  totalRefundedCents: number;
  totalOutCents: number;
  netHeldCents: number;
}

/**
 * Builds the complete tournament ledger (T-064):
 * Every payment in, every refund, and every payout out.
 * After a successful payout, `netHeldCents === 0` (`totalInCents - totalOutCents === 0`).
 */
export async function getTournamentLedger(
  tournamentId: string
): Promise<TournamentLedger> {
  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.tournamentId, tournamentId))
    .orderBy(asc(payments.createdAt));

  const entryRows = await db
    .select()
    .from(entries)
    .where(eq(entries.tournamentId, tournamentId));

  const entryMap = new Map(entryRows.map((e) => [e.id, e]));
  const entryByPlayerMap = new Map(entryRows.map((e) => [e.playerId, e]));

  const rows: LedgerEntryRow[] = [];
  let totalInCents = 0;
  let totalRefundedCents = 0;
  let totalOutCents = 0;

  for (const p of paymentRows) {
    const e = entryMap.get(p.entryId);
    const gamertag = e?.gamertag ?? "Player";

    if (
      p.status === "captured" ||
      p.status === "refunded" ||
      p.status === "refund_pending"
    ) {
      totalInCents += p.amountCents;
      rows.push({
        id: `in-${p.id}`,
        direction: "in",
        label: "Entry fee",
        gamertag,
        amountCents: p.amountCents,
        status: "captured",
        referenceId: p.paypalCaptureId ?? p.paypalOrderId ?? null,
        createdAt: p.createdAt,
      });
    }

    if (p.status === "refunded" || p.status === "refund_pending") {
      if (p.status === "refunded") {
        totalRefundedCents += p.amountCents;
      }
      rows.push({
        id: `ref-${p.id}`,
        direction: "refund",
        label: "Entry fee refund",
        gamertag,
        amountCents: p.amountCents,
        status: p.status,
        referenceId: p.refundId ?? null,
        createdAt: p.updatedAt,
      });
    }
  }

  const payoutRows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.tournamentId, tournamentId))
    .orderBy(asc(payouts.place));

  for (const po of payoutRows) {
    const e = entryByPlayerMap.get(po.recipientId);
    const gamertag = e?.gamertag ?? `Place ${po.place}`;
    if (po.status === "succeeded") {
      totalOutCents += po.amountCents;
    }
    rows.push({
      id: `out-${po.id}`,
      direction: "out",
      label: po.place === 1 ? "1st place payout" : "2nd place payout",
      gamertag,
      amountCents: po.amountCents,
      status: po.status,
      referenceId: po.paypalItemId ?? po.paypalBatchId ?? po.senderItemId,
      createdAt: po.createdAt,
    });
  }

  const netHeldCents = totalInCents - totalRefundedCents - totalOutCents;

  return {
    rows,
    totalInCents,
    totalRefundedCents,
    totalOutCents,
    netHeldCents,
  };
}
