import { z } from "zod";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { captureRequestId, orderRequestId } from "@/lib/ids";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import {
  db,
  entries,
  payments,
  tournaments,
  users,
  type DbOrTx,
} from "@/server/db";
import { getPayPalClient, type PayPalClient } from "./client";
import { issueRefundForPayment } from "./refunds";

export const joinTournamentSchema = z.object({
  gamertag: z
    .string({ error: "Enter your in-game gamertag." })
    .trim()
    .min(2, "Gamertag must be at least 2 characters.")
    .max(24, "Gamertag must be at most 24 characters."),
  paypalEmail: z
    .string({ error: "Enter your PayPal sandbox personal email." })
    .trim()
    .toLowerCase()
    .email("Enter a valid PayPal sandbox email address."),
});

export interface JoinTournamentResult {
  entryId: string;
  paymentId: string;
  orderId: string;
  approveUrl: string;
}

const PENDING_ENTRY_EXPIRY_MINUTES = 15;

/**
 * Expires pending entries older than 15 minutes whose payment is not captured (T-038).
 */
export async function expireStalePendingEntries(
  tournamentId?: string,
  options?: { now?: Date; txOrDb?: DbOrTx }
): Promise<number> {
  const now = options?.now ?? new Date();
  const txOrDb = options?.txOrDb ?? db;
  const cutoff = new Date(
    now.getTime() - PENDING_ENTRY_EXPIRY_MINUTES * 60 * 1000
  );

  const conditions = [
    eq(entries.status, "pending"),
    lt(entries.createdAt, cutoff),
  ];
  if (tournamentId) {
    conditions.push(eq(entries.tournamentId, tournamentId));
  }

  const staleEntries = await txOrDb
    .select()
    .from(entries)
    .where(and(...conditions));

  let expiredCount = 0;
  for (const entry of staleEntries) {
    const [payment] = await txOrDb
      .select()
      .from(payments)
      .where(eq(payments.entryId, entry.id))
      .limit(1);

    if (payment && payment.status === "captured") {
      continue;
    }

    await txOrDb
      .update(entries)
      .set({ status: "expired" })
      .where(and(eq(entries.id, entry.id), eq(entries.status, "pending")));

    if (payment && payment.status === "created") {
      await txOrDb
        .update(payments)
        .set({ status: "failed", updatedAt: now })
        .where(eq(payments.id, payment.id));
    }

    await audit(txOrDb, {
      tournamentId: entry.tournamentId,
      actorType: "agent",
      action: "entry.expired",
      payload: {
        entryId: entry.id,
        gamertag: entry.gamertag,
      },
      dedupeKey: `expire:${entry.id}`,
    });

    expiredCount += 1;
  }

  return expiredCount;
}

/**
 * Reserves a slot in an open tournament, creates `entries` and `payments` rows,
 * and creates a PayPal Order with deterministic `PayPal-Request-Id = entry-<entryId>` (T-032).
 * Double-clicks return the same order without reserving a second slot (EC-P2).
 */
export async function joinTournamentAndCreateOrder(
  input: {
    tournamentId: string;
    playerId: string;
    gamertag: string;
    paypalEmail: string;
  },
  options?: {
    paypal?: PayPalClient;
    now?: Date;
  }
): Promise<JoinTournamentResult> {
  const parsed = joinTournamentSchema.safeParse({
    gamertag: input.gamertag,
    paypalEmail: input.paypalEmail,
  });
  if (!parsed.success) {
    const firstMsg =
      parsed.error.issues[0]?.message ?? "Check your gamertag and PayPal email.";
    throw new AppError("VALIDATION", firstMsg, 400, {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  }

  const { gamertag, paypalEmail } = parsed.data;
  const paypal = options?.paypal ?? getPayPalClient();
  const now = options?.now ?? new Date();

  // Save the player's PayPal sandbox email on their user record
  await db
    .update(users)
    .set({ paypalEmail })
    .where(eq(users.id, input.playerId));

  // Step 1: Reserve slot and create/reuse entry + payment inside a transaction locking the tournament row
  const reserved = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from tournaments where id = ${input.tournamentId} for update`
    );

    // Expire any stale pending entries first so abandoned checkouts don't block slots
    await expireStalePendingEntries(input.tournamentId, { now, txOrDb: tx });

    const [tournament] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, input.tournamentId))
      .limit(1);

    if (!tournament) {
      throw new AppError("NOT_FOUND", "Tournament not found.", 404);
    }

    // Check if player already has an entry row in this tournament
    const [existingEntry] = await tx
      .select()
      .from(entries)
      .where(
        and(
          eq(entries.tournamentId, input.tournamentId),
          eq(entries.playerId, input.playerId)
        )
      )
      .limit(1);

    if (existingEntry) {
      if (existingEntry.status === "paid") {
        throw new AppError(
          "ALREADY_DONE",
          "You have already joined and paid for this tournament.",
          409
        );
      }

      if (existingEntry.status === "pending") {
        const [existingPayment] = await tx
          .select()
          .from(payments)
          .where(eq(payments.entryId, existingEntry.id))
          .limit(1);

        if (existingPayment) {
          return {
            tournament,
            entry: existingEntry,
            payment: existingPayment,
          };
        }
      }
    }

    if (tournament.state !== "open") {
      throw new AppError(
        "INVALID_TRANSITION",
        "This tournament is not open for registration.",
        409
      );
    }

    if (
      tournament.registrationClosesAt &&
      now.getTime() > tournament.registrationClosesAt.getTime()
    ) {
      throw new AppError(
        "INVALID_TRANSITION",
        "Registration for this tournament has closed.",
        409
      );
    }

    // Check gamertag uniqueness among other players in this tournament
    const [gamertagConflict] = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(
        and(
          eq(entries.tournamentId, input.tournamentId),
          eq(entries.gamertag, gamertag),
          ne(entries.playerId, input.playerId)
        )
      )
      .limit(1);

    if (gamertagConflict) {
      throw new AppError(
        "VALIDATION",
        `Gamertag "${gamertag}" is already taken in this tournament.`,
        400
      );
    }

    // Slot reservation rule: count(entries where status in ('pending', 'paid')) < slots
    const activeEntries = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(
        and(
          eq(entries.tournamentId, input.tournamentId),
          inArray(entries.status, ["pending", "paid"])
        )
      );

    if (activeEntries.length >= tournament.slots) {
      throw new AppError(
        "TOURNAMENT_FULL",
        "This tournament is full. All 8 slots are taken or in checkout.",
        409
      );
    }

    if (existingEntry) {
      // Reactivate a previously cancelled or expired entry for this player
      const [reactivatedEntry] = await tx
        .update(entries)
        .set({
          gamertag,
          status: "pending",
          createdAt: now,
        })
        .where(eq(entries.id, existingEntry.id))
        .returning();

      const reqKey = orderRequestId(reactivatedEntry.id);
      const [existingPayment] = await tx
        .select()
        .from(payments)
        .where(eq(payments.entryId, reactivatedEntry.id))
        .limit(1);

      let paymentRow: typeof payments.$inferSelect;
      if (existingPayment) {
        [paymentRow] = await tx
          .update(payments)
          .set({
            status: "created",
            paypalOrderId: null,
            paypalCaptureId: null,
            amountCents: tournament.entryFeeCents,
            updatedAt: now,
          })
          .where(eq(payments.id, existingPayment.id))
          .returning();
      } else {
        [paymentRow] = await tx
          .insert(payments)
          .values({
            tournamentId: tournament.id,
            entryId: reactivatedEntry.id,
            amountCents: tournament.entryFeeCents,
            status: "created",
            idempotencyKey: reqKey,
          })
          .returning();
      }

      return {
        tournament,
        entry: reactivatedEntry,
        payment: paymentRow,
      };
    }

    const [createdEntry] = await tx
      .insert(entries)
      .values({
        tournamentId: tournament.id,
        playerId: input.playerId,
        gamertag,
        status: "pending",
        simulated: false,
        createdAt: now,
      })
      .returning();

    const [createdPayment] = await tx
      .insert(payments)
      .values({
        tournamentId: tournament.id,
        entryId: createdEntry.id,
        amountCents: tournament.entryFeeCents,
        status: "created",
        idempotencyKey: orderRequestId(createdEntry.id),
      })
      .returning();

    return {
      tournament,
      entry: createdEntry,
      payment: createdPayment,
    };
  });

  // Step 2: Create (or retrieve idempotent) PayPal order using PayPal-Request-Id: entry-<entryId>
  const returnUrl = `${env.APP_URL}/api/paypal/return?entry=${reserved.entry.id}`;
  const cancelUrl = `${env.APP_URL}/api/paypal/cancel?entry=${reserved.entry.id}`;

  const order = await paypal.createOrder({
    entryId: reserved.entry.id,
    tournamentTitle: reserved.tournament.title,
    amountCents: reserved.tournament.entryFeeCents,
    returnUrl,
    cancelUrl,
    requestId: reserved.payment.idempotencyKey,
  });

  if (reserved.payment.paypalOrderId !== order.orderId) {
    await db
      .update(payments)
      .set({
        paypalOrderId: order.orderId,
        updatedAt: now,
      })
      .where(eq(payments.id, reserved.payment.id));
  }

  return {
    entryId: reserved.entry.id,
    paymentId: reserved.payment.id,
    orderId: order.orderId,
    approveUrl: order.approveUrl,
  };
}

export interface ReturnCaptureOutcome {
  status: "captured" | "already_captured" | "overflow_refunded";
  tournamentId: string;
  entryId: string;
  amountCents: number;
}

/**
 * Handles GET /api/paypal/return (T-033, T-036, T-038):
 * 1. Loads entry and payment from DB (never trusts URL amount).
 * 2. Refresh-safe: if already captured, skips PayPal call and returns `already_captured`.
 * 3. GETs order from PayPal and verifies APPROVED/COMPLETED, customId === entry.id, amountCents === entryFeeCents.
 * 4. Captures with deterministic `capture-<entryId>`.
 * 5. Overflow / late-capture protection: if tournament is already full (8 paid), not `open`, or entry expired,
 *    automatically refunds the capture and returns `overflow_refunded`.
 */
export async function verifyAndCaptureEntryOrder(
  entryId: string,
  options?: {
    tokenOrderId?: string | null;
    paypal?: PayPalClient;
    now?: Date;
  }
): Promise<ReturnCaptureOutcome> {
  const paypal = options?.paypal ?? getPayPalClient();
  const now = options?.now ?? new Date();

  const [entry] = await db
    .select()
    .from(entries)
    .where(eq(entries.id, entryId))
    .limit(1);

  if (!entry) {
    throw new AppError("NOT_FOUND", "Tournament entry not found.", 404);
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.entryId, entry.id))
    .limit(1);

  if (!payment) {
    throw new AppError("NOT_FOUND", "Payment record not found.", 404);
  }

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, entry.tournamentId))
    .limit(1);

  if (!tournament) {
    throw new AppError("NOT_FOUND", "Tournament not found.", 404);
  }

  // Refresh safety (EC-P3): already captured and paid -> do not call PayPal capture again
  if (payment.status === "captured" && entry.status === "paid") {
    return {
      status: "already_captured",
      tournamentId: tournament.id,
      entryId: entry.id,
      amountCents: payment.amountCents,
    };
  }

  if (payment.status === "refunded" || payment.status === "refund_pending") {
    return {
      status: "overflow_refunded",
      tournamentId: tournament.id,
      entryId: entry.id,
      amountCents: payment.amountCents,
    };
  }

  const orderId = payment.paypalOrderId ?? options?.tokenOrderId ?? null;
  if (!orderId) {
    throw new AppError(
      "PAYMENT_FAILED",
      "No PayPal order ID is associated with this entry.",
      400
    );
  }

  // Verify order with PayPal GET /v2/checkout/orders/<orderId>
  const orderDetails = await paypal.getOrder(orderId);
  const validStatus =
    orderDetails.status === "APPROVED" || orderDetails.status === "COMPLETED";
  const validReference = orderDetails.customId === entry.id;
  const validAmount =
    orderDetails.amountCents === tournament.entryFeeCents &&
    orderDetails.currencyCode === "USD";

  if (!validStatus || !validReference || !validAmount) {
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: "failed", updatedAt: now })
        .where(eq(payments.id, payment.id));
      if (entry.status === "pending") {
        await tx
          .update(entries)
          .set({ status: "cancelled" })
          .where(eq(entries.id, entry.id));
      }
    });

    throw new AppError(
      "PAYMENT_FAILED",
      "PayPal checkout verification failed (status, amount, or reference mismatch). Your slot has been released.",
      400
    );
  }

  // Capture with deterministic request id `capture-<entryId>`
  let captureResult;
  try {
    captureResult = await paypal.captureOrder(
      orderId,
      captureRequestId(entry.id)
    );
  } catch (err) {
    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: "failed", updatedAt: now })
        .where(eq(payments.id, payment.id));
      if (entry.status === "pending") {
        await tx
          .update(entries)
          .set({ status: "cancelled" })
          .where(eq(entries.id, entry.id));
      }
    });
    if (err instanceof AppError) {
      throw new AppError(
        "PAYMENT_FAILED",
        "PayPal payment could not be captured. Your slot is free to try again.",
        400
      );
    }
    throw err;
  }

  // Seat player or trigger overflow/expired refund inside a row-locked transaction
  const seatDecision = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from tournaments where id = ${tournament.id} for update`
    );

    const [freshTournament] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournament.id))
      .limit(1);

    const [freshEntry] = await tx
      .select()
      .from(entries)
      .where(eq(entries.id, entry.id))
      .limit(1);

    const [freshPayment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, payment.id))
      .limit(1);

    if (
      freshPayment.status === "captured" &&
      freshEntry.status === "paid"
    ) {
      return { action: "already_captured" as const };
    }

    const paidEntries = await tx
      .select({ id: entries.id })
      .from(entries)
      .where(
        and(
          eq(entries.tournamentId, tournament.id),
          eq(entries.status, "paid"),
          ne(entries.id, entry.id)
        )
      );

    // Check if entry expired by timestamp (>15 min) or explicit status, or tournament is full / not open
    const isExpiredByClock =
      freshEntry.status === "pending" &&
      now.getTime() - freshEntry.createdAt.getTime() >
        PENDING_ENTRY_EXPIRY_MINUTES * 60 * 1000;
    const isEntryExpiredOrCancelled =
      freshEntry.status === "expired" ||
      freshEntry.status === "cancelled" ||
      isExpiredByClock;
    const isTournamentUnavailable =
      freshTournament.state !== "open" ||
      paidEntries.length >= freshTournament.slots;

    if (isEntryExpiredOrCancelled || isTournamentUnavailable) {
      await tx
        .update(payments)
        .set({
          paypalOrderId: orderId,
          paypalCaptureId: captureResult.captureId,
          status: "refund_pending",
          stateAtCapture: freshTournament.state,
          updatedAt: now,
        })
        .where(eq(payments.id, payment.id));

      return { action: "refund_overflow" as const };
    }

    await tx
      .update(payments)
      .set({
        paypalOrderId: orderId,
        paypalCaptureId: captureResult.captureId,
        status: "captured",
        stateAtCapture: freshTournament.state,
        updatedAt: now,
      })
      .where(eq(payments.id, payment.id));

    await tx
      .update(entries)
      .set({ status: "paid" })
      .where(eq(entries.id, entry.id));

    await audit(tx, {
      tournamentId: tournament.id,
      actorType: "paypal",
      actorId: entry.playerId,
      action: "entry.paid",
      payload: {
        entryId: entry.id,
        gamertag: entry.gamertag,
        amountCents: payment.amountCents,
        captureId: captureResult.captureId,
      },
      dedupeKey: `paid:${entry.id}`,
    });

    return { action: "seated" as const };
  });

  if (seatDecision.action === "refund_overflow") {
    await issueRefundForPayment(payment.id, { paypal, now });
    return {
      status: "overflow_refunded",
      tournamentId: tournament.id,
      entryId: entry.id,
      amountCents: payment.amountCents,
    };
  }

  return {
    status:
      seatDecision.action === "already_captured"
        ? "already_captured"
        : "captured",
    tournamentId: tournament.id,
    entryId: entry.id,
    amountCents: payment.amountCents,
  };
}

/**
 * Handles GET /api/paypal/cancel: marks entry cancelled, payment failed, frees the slot (T-033, EC-P1).
 */
export async function cancelEntryOrder(
  entryId: string,
  options?: { now?: Date }
): Promise<{ tournamentId: string; entryId: string }> {
  const now = options?.now ?? new Date();

  const [entry] = await db
    .select()
    .from(entries)
    .where(eq(entries.id, entryId))
    .limit(1);

  if (!entry) {
    throw new AppError("NOT_FOUND", "Entry not found.", 404);
  }

  await db.transaction(async (tx) => {
    const [freshEntry] = await tx
      .select()
      .from(entries)
      .where(eq(entries.id, entryId))
      .limit(1);

    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.entryId, entryId))
      .limit(1);

    if (payment && payment.status === "captured") {
      return;
    }

    if (freshEntry && freshEntry.status === "pending") {
      await tx
        .update(entries)
        .set({ status: "cancelled" })
        .where(eq(entries.id, entryId));
    }

    if (payment && payment.status === "created") {
      await tx
        .update(payments)
        .set({ status: "failed", updatedAt: now })
        .where(eq(payments.id, payment.id));
    }
  });

  return {
    tournamentId: entry.tournamentId,
    entryId: entry.id,
  };
}

/**
 * Computes live prize pool in cents directly from captured, non-refunded payments in DB (T-035).
 */
export async function getLivePrizePoolCents(
  tournamentId: string,
  txOrDb: DbOrTx = db
): Promise<number> {
  const capturedRows = await txOrDb
    .select({ amountCents: payments.amountCents })
    .from(payments)
    .where(
      and(
        eq(payments.tournamentId, tournamentId),
        eq(payments.status, "captured")
      )
    );

  return capturedRows.reduce((sum, row) => sum + row.amountCents, 0);
}
