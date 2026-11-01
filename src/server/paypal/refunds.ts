import { and, eq, inArray } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { refundRequestId } from "@/lib/ids";
import { audit } from "@/server/audit";
import {
  db,
  entries,
  payments,
  tournaments,
  type DbOrTx,
} from "@/server/db";
import { assertTransition } from "@/server/tournament/state-machine";
import { getPayPalClient, type PayPalClient } from "./client";

export interface RefundPaymentOutcome {
  paymentId: string;
  refundId: string | null;
  status: "refunded" | "refund_pending";
  error?: string;
}

/**
 * Issues a full refund for a captured payment using deterministic `PayPal-Request-Id: refund-<paymentId>`.
 * Safe to call multiple times (idempotent).
 */
export async function issueRefundForPayment(
  paymentId: string,
  options?: {
    paypal?: PayPalClient;
    now?: Date;
  }
): Promise<RefundPaymentOutcome> {
  const paypal = options?.paypal ?? getPayPalClient();
  const now = options?.now ?? new Date();

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (!payment) {
    throw new AppError("NOT_FOUND", "Payment not found.", 404);
  }

  if (payment.status === "refunded") {
    return {
      paymentId: payment.id,
      refundId: payment.refundId ?? null,
      status: "refunded",
    };
  }

  if (!payment.paypalCaptureId) {
    throw new AppError(
      "VALIDATION",
      "Cannot refund a payment that has no PayPal capture ID.",
      400
    );
  }

  const [entry] = await db
    .select()
    .from(entries)
    .where(eq(entries.id, payment.entryId))
    .limit(1);

  // Mark refund_pending before calling external API
  if (payment.status !== "refund_pending") {
    await db
      .update(payments)
      .set({ status: "refund_pending", updatedAt: now })
      .where(eq(payments.id, payment.id));
  }

  try {
    const res = await paypal.refundCapture(
      payment.paypalCaptureId,
      refundRequestId(payment.id)
    );

    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({
          status: "refunded",
          refundId: res.refundId,
          updatedAt: now,
        })
        .where(eq(payments.id, payment.id));

      if (entry) {
        await tx
          .update(entries)
          .set({ status: "refunded" })
          .where(eq(entries.id, entry.id));
      }

      await audit(tx, {
        tournamentId: payment.tournamentId,
        actorType: "agent",
        action: "refund.issued",
        payload: {
          paymentId: payment.id,
          entryId: payment.entryId,
          gamertag: entry?.gamertag ?? "Player",
          amountCents: payment.amountCents,
          refundId: res.refundId,
        },
        dedupeKey: `refund:${payment.id}`,
      });
    });

    return {
      paymentId: payment.id,
      refundId: res.refundId,
      status: "refunded",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      paymentId: payment.id,
      refundId: null,
      status: "refund_pending",
      error: message,
    };
  }
}

/**
 * Refunds all captured/refund_pending payments for a cancelled tournament.
 * Once all captured payments are refunded (vacuously true if 0 captured payments),
 * transitions tournament state from `cancelled` to `refunded`.
 */
export async function refundTournamentPayments(
  tournamentId: string,
  options?: {
    paypal?: PayPalClient;
    now?: Date;
  }
): Promise<{
  outcomes: RefundPaymentOutcome[];
  allRefunded: boolean;
}> {
  const toRefund = await db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.tournamentId, tournamentId),
        inArray(payments.status, ["captured", "refund_pending"])
      )
    );

  const outcomes: RefundPaymentOutcome[] = [];
  for (const p of toRefund) {
    const outcome = await issueRefundForPayment(p.id, options);
    outcomes.push(outcome);
  }

  // Check if any captured or refund_pending payments remain
  const remaining = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.tournamentId, tournamentId),
        inArray(payments.status, ["captured", "refund_pending"])
      )
    );

  const allRefunded = remaining.length === 0;

  if (allRefunded) {
    await db.transaction(async (tx) => {
      const [t] = await tx
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, tournamentId))
        .limit(1);

      if (t && t.state === "cancelled") {
        assertTransition("cancelled", "refunded");
        await tx
          .update(tournaments)
          .set({ state: "refunded" })
          .where(eq(tournaments.id, tournamentId));

        await audit(tx, {
          tournamentId,
          actorType: "agent",
          action: "tournament.refunded",
          payload: { refundedCount: outcomes.length },
          dedupeKey: `refunded:${tournamentId}`,
        });
      }
    });
  }

  return { outcomes, allRefunded };
}

/**
 * Host cancels tournament (in draft or open) and immediately triggers refunds for any captured payments.
 */
export async function cancelAndRefundTournament(
  hostId: string,
  tournamentId: string,
  reason = "Cancelled by host",
  options?: {
    paypal?: PayPalClient;
    now?: Date;
    actorType?: "user" | "agent";
    auditAction?: "tournament.cancelled" | "tournament.auto_cancelled";
  }
): Promise<{
  tournament: typeof tournaments.$inferSelect;
  allRefunded: boolean;
}> {
  const actorType = options?.actorType ?? "user";
  const auditAction = options?.auditAction ?? "tournament.cancelled";

  await db.transaction(async (tx: DbOrTx) => {
    const [tournament] = await tx
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId))
      .limit(1);

    if (!tournament) {
      throw new AppError("NOT_FOUND", "Tournament not found.", 404);
    }
    if (actorType === "user" && tournament.hostId !== hostId) {
      throw new AppError(
        "FORBIDDEN",
        "Only the tournament host can cancel this tournament.",
        403
      );
    }

    if (tournament.state !== "cancelled" && tournament.state !== "refunded") {
      assertTransition(tournament.state, "cancelled");

      await tx
        .update(entries)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(entries.tournamentId, tournamentId),
            eq(entries.status, "pending")
          )
        );

      await tx
        .update(tournaments)
        .set({
          state: "cancelled",
          cancelReason: reason,
        })
        .where(eq(tournaments.id, tournamentId));

      await audit(tx, {
        tournamentId,
        actorType,
        actorId: actorType === "user" ? hostId : null,
        action: auditAction,
        payload: { reason },
        dedupeKey: `cancel:${tournamentId}`,
      });
    }
  });

  const { allRefunded } = await refundTournamentPayments(tournamentId, options);
  const [updated] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  return { tournament: updated, allRefunded };
}
