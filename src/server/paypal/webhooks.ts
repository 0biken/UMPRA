import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import {
  db,
  entries,
  payments,
  payouts,
  tournaments,
  webhookEvents,
} from "@/server/db";
import { assertTransition } from "@/server/tournament/state-machine";
import { getPayPalClient, type PayPalClient } from "./client";
import { issueRefundForPayment } from "./refunds";

export interface PayPalWebhookEnvelope {
  id: string;
  event_type: string;
  resource?: Record<string, unknown>;
}

export interface WebhookHeaders {
  authAlgo: string | null;
  certUrl: string | null;
  transmissionId: string | null;
  transmissionSig: string | null;
  transmissionTime: string | null;
}

export interface ProcessWebhookResult {
  eventId: string;
  duplicate: boolean;
  processed: boolean;
}

async function dispatchWebhookEvent(
  event: PayPalWebhookEnvelope,
  options?: { paypal?: PayPalClient; now?: Date }
): Promise<boolean> {
  const now = options?.now ?? new Date();
  const resource = (event.resource ?? {}) as Record<string, unknown>;

  switch (event.event_type) {
    case "CHECKOUT.ORDER.APPROVED": {
      return true;
    }

    case "PAYMENT.CAPTURE.COMPLETED": {
      const captureId =
        typeof resource.id === "string" ? resource.id : null;
      const customId =
        typeof resource.custom_id === "string" ? resource.custom_id : null;
      const supplementary = resource.supplementary_data as
        | { related_ids?: { order_id?: string } }
        | undefined;
      const orderId = supplementary?.related_ids?.order_id ?? null;

      const conditions = [];
      if (captureId) conditions.push(eq(payments.paypalCaptureId, captureId));
      if (orderId) conditions.push(eq(payments.paypalOrderId, orderId));
      if (customId) conditions.push(eq(payments.entryId, customId));

      if (conditions.length === 0) {
        return false;
      }

      const [payment] = await db
        .select()
        .from(payments)
        .where(conditions.length === 1 ? conditions[0] : or(...conditions))
        .limit(1);

      // Out-of-order delivery: webhook beat our row write -> leave unprocessed for sweep
      if (!payment) {
        return false;
      }

      if (
        payment.status === "captured" ||
        payment.status === "refunded" ||
        payment.status === "refund_pending"
      ) {
        return true;
      }

      const [entry] = await db
        .select()
        .from(entries)
        .where(eq(entries.id, payment.entryId))
        .limit(1);

      const [tournament] = await db
        .select()
        .from(tournaments)
        .where(eq(tournaments.id, payment.tournamentId))
        .limit(1);

      if (!entry || !tournament) {
        return false;
      }

      // Reconcile inside row-locked transaction with overflow/expired check
      const action = await db.transaction(async (tx) => {
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

        const paidEntries = await tx
          .select({ id: entries.id })
          .from(entries)
          .where(
            and(
              eq(entries.tournamentId, tournament.id),
              eq(entries.status, "paid")
            )
          );

        const shouldRefund =
          freshEntry.status === "expired" ||
          freshEntry.status === "cancelled" ||
          freshTournament.state !== "open" ||
          (freshEntry.status !== "paid" &&
            paidEntries.length >= freshTournament.slots);

        if (shouldRefund) {
          await tx
            .update(payments)
            .set({
              paypalCaptureId: captureId ?? payment.paypalCaptureId,
              status: "refund_pending",
              stateAtCapture: freshTournament.state,
              updatedAt: now,
            })
            .where(eq(payments.id, payment.id));
          return "refund" as const;
        }

        await tx
          .update(payments)
          .set({
            paypalCaptureId: captureId ?? payment.paypalCaptureId,
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
            captureId,
          },
          dedupeKey: `paid:${entry.id}`,
        });

        return "captured" as const;
      });

      if (action === "refund") {
        await issueRefundForPayment(payment.id, options);
      }

      return true;
    }

    case "PAYMENT.CAPTURE.DENIED": {
      const captureId =
        typeof resource.id === "string" ? resource.id : null;
      const customId =
        typeof resource.custom_id === "string" ? resource.custom_id : null;
      const conditions = [];
      if (captureId) conditions.push(eq(payments.paypalCaptureId, captureId));
      if (customId) conditions.push(eq(payments.entryId, customId));
      if (conditions.length === 0) return false;

      const [payment] = await db
        .select()
        .from(payments)
        .where(conditions.length === 1 ? conditions[0] : or(...conditions))
        .limit(1);

      if (!payment) return false;

      await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({ status: "failed", updatedAt: now })
          .where(eq(payments.id, payment.id));
        await tx
          .update(entries)
          .set({ status: "cancelled" })
          .where(
            and(
              eq(entries.id, payment.entryId),
              eq(entries.status, "pending")
            )
          );
      });
      return true;
    }

    case "PAYMENT.CAPTURE.REFUNDED": {
      const links = Array.isArray(resource.links)
        ? (resource.links as Array<{ rel?: string; href?: string }>)
        : [];
      const upLink = links.find((l) => l.rel === "up")?.href ?? "";
      const captureIdFromLink = upLink.split("/captures/")[1]?.split("/")[0];
      const captureId =
        captureIdFromLink ??
        (typeof resource.capture_id === "string"
          ? resource.capture_id
          : null);
      const customId =
        typeof resource.custom_id === "string" ? resource.custom_id : null;

      const conditions = [];
      if (captureId) conditions.push(eq(payments.paypalCaptureId, captureId));
      if (customId) conditions.push(eq(payments.entryId, customId));
      if (conditions.length === 0) return false;

      const [payment] = await db
        .select()
        .from(payments)
        .where(conditions.length === 1 ? conditions[0] : or(...conditions))
        .limit(1);

      if (!payment) return false;

      await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({
            status: "refunded",
            refundId:
              typeof resource.id === "string" ? resource.id : payment.refundId,
            updatedAt: now,
          })
          .where(eq(payments.id, payment.id));

        await tx
          .update(entries)
          .set({ status: "refunded" })
          .where(eq(entries.id, payment.entryId));
      });

      return true;
    }

    case "PAYMENT.PAYOUTSBATCH.SUCCESS":
    case "PAYMENT.PAYOUTSBATCH.DENIED": {
      const batchHeader = resource.batch_header as
        | {
            payout_batch_id?: string;
            sender_batch_header?: { sender_batch_id?: string };
          }
        | undefined;
      const batchId = batchHeader?.payout_batch_id ?? null;
      const senderBatchId =
        batchHeader?.sender_batch_header?.sender_batch_id ?? null;

      const conditions = [];
      if (batchId) conditions.push(eq(payouts.paypalBatchId, batchId));
      if (senderBatchId)
        conditions.push(eq(payouts.senderBatchId, senderBatchId));
      if (conditions.length === 0) return false;

      const rows = await db
        .select()
        .from(payouts)
        .where(conditions.length === 1 ? conditions[0] : or(...conditions));

      if (rows.length === 0) return false;

      if (event.event_type === "PAYMENT.PAYOUTSBATCH.DENIED") {
        for (const r of rows) {
          await db
            .update(payouts)
            .set({ status: "failed", error: "Payout batch denied by PayPal" })
            .where(eq(payouts.id, r.id));
        }
      }
      return true;
    }

    case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED":
    case "PAYMENT.PAYOUTS-ITEM.FAILED":
    case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED": {
      const payoutItem = resource.payout_item as
        | { sender_item_id?: string }
        | undefined;
      const senderItemId =
        payoutItem?.sender_item_id ??
        (typeof resource.sender_item_id === "string"
          ? resource.sender_item_id
          : null);
      const payoutItemId =
        typeof resource.payout_item_id === "string"
          ? resource.payout_item_id
          : null;

      if (!senderItemId) return false;

      const [payoutRow] = await db
        .select()
        .from(payouts)
        .where(eq(payouts.senderItemId, senderItemId))
        .limit(1);

      if (!payoutRow) return false;

      const newStatus =
        event.event_type === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED"
          ? ("succeeded" as const)
          : event.event_type === "PAYMENT.PAYOUTS-ITEM.UNCLAIMED"
            ? ("unclaimed" as const)
            : ("failed" as const);

      const errObj = resource.errors as { message?: string } | undefined;
      const errorMsg =
        newStatus === "succeeded"
          ? null
          : errObj?.message ??
            (newStatus === "unclaimed"
              ? "Recipient PayPal email is unclaimed."
              : "Payout item failed.");

      await db.transaction(async (tx) => {
        await tx
          .update(payouts)
          .set({
            status: newStatus,
            paypalItemId: payoutItemId ?? payoutRow.paypalItemId,
            error: errorMsg,
          })
          .where(eq(payouts.id, payoutRow.id));

        const [winnerEntry] = await tx
          .select()
          .from(entries)
          .where(
            and(
              eq(entries.tournamentId, payoutRow.tournamentId),
              eq(entries.playerId, payoutRow.recipientId)
            )
          )
          .limit(1);

        if (newStatus === "succeeded") {
          await audit(tx, {
            tournamentId: payoutRow.tournamentId,
            actorType: "paypal",
            actorId: payoutRow.recipientId,
            action: "payout.item_succeeded",
            payload: {
              payoutId: payoutRow.id,
              place: payoutRow.place,
              gamertag: winnerEntry?.gamertag ?? "Winner",
              amountCents: payoutRow.amountCents,
            },
            dedupeKey: `payout-succeeded:${payoutRow.id}`,
          });
        } else {
          await audit(tx, {
            tournamentId: payoutRow.tournamentId,
            actorType: "paypal",
            actorId: payoutRow.recipientId,
            action: "payout.item_failed",
            payload: {
              payoutId: payoutRow.id,
              place: payoutRow.place,
              gamertag: winnerEntry?.gamertag ?? "Winner",
              amountCents: payoutRow.amountCents,
              error: errorMsg,
            },
            dedupeKey: `payout-failed:${payoutRow.id}:${newStatus}`,
          });
        }

        // Check if ALL payout items for the tournament have succeeded
        const allItems = await tx
          .select()
          .from(payouts)
          .where(eq(payouts.tournamentId, payoutRow.tournamentId));

        if (
          allItems.length > 0 &&
          allItems.every((item) => item.status === "succeeded")
        ) {
          const [t] = await tx
            .select()
            .from(tournaments)
            .where(eq(tournaments.id, payoutRow.tournamentId))
            .limit(1);

          if (t && t.state === "confirmed") {
            assertTransition("confirmed", "paid");
            await tx
              .update(tournaments)
              .set({ state: "paid" })
              .where(eq(tournaments.id, t.id));
          }
        }
      });

      return true;
    }

    default:
      return true;
  }
}

/**
 * Verifies, deduplicates, stores, and dispatches a raw PayPal webhook payload (T-034).
 */
export async function handlePayPalWebhook(
  rawBody: string,
  headers: WebhookHeaders,
  options?: {
    paypal?: PayPalClient;
    verifySignature?: boolean;
    now?: Date;
  }
): Promise<ProcessWebhookResult> {
  const paypal = options?.paypal ?? getPayPalClient();
  const shouldVerify = options?.verifySignature ?? env.PAYPAL_WEBHOOK_VERIFY;
  const now = options?.now ?? new Date();

  let event: PayPalWebhookEnvelope;
  try {
    event = JSON.parse(rawBody) as PayPalWebhookEnvelope;
  } catch {
    throw new AppError("VALIDATION", "Invalid JSON webhook payload.", 400);
  }

  if (!event || typeof event.id !== "string" || typeof event.event_type !== "string") {
    throw new AppError(
      "VALIDATION",
      "Webhook payload missing id or event_type.",
      400
    );
  }

  if (shouldVerify) {
    if (
      !headers.authAlgo ||
      !headers.certUrl ||
      !headers.transmissionId ||
      !headers.transmissionSig ||
      !headers.transmissionTime
    ) {
      throw new AppError(
        "VALIDATION",
        "Missing PayPal webhook signature headers.",
        400
      );
    }

    const verified = await paypal.verifyWebhookSignature({
      authAlgo: headers.authAlgo,
      certUrl: headers.certUrl,
      transmissionId: headers.transmissionId,
      transmissionSig: headers.transmissionSig,
      transmissionTime: headers.transmissionTime,
      webhookId: env.PAYPAL_WEBHOOK_ID,
      webhookEvent: event,
    });

    if (!verified) {
      throw new AppError(
        "VALIDATION",
        "PayPal webhook signature verification failed.",
        400
      );
    }
  }

  // Deduplicate via webhook_events.id primary key
  const [existing] = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.id, event.id))
    .limit(1);

  if (existing && existing.processedAt) {
    return {
      eventId: event.id,
      duplicate: true,
      processed: true,
    };
  }

  if (!existing) {
    await db
      .insert(webhookEvents)
      .values({
        id: event.id,
        eventType: event.event_type,
        payload: event as unknown as Record<string, unknown>,
        verified: true,
        processedAt: null,
        createdAt: now,
      })
      .onConflictDoNothing();
  }

  const processed = await dispatchWebhookEvent(event, { paypal, now });
  if (processed) {
    await db
      .update(webhookEvents)
      .set({ processedAt: now })
      .where(eq(webhookEvents.id, event.id));
  }

  return {
    eventId: event.id,
    duplicate: Boolean(existing),
    processed,
  };
}

/**
 * Reprocesses any out-of-order webhook events that arrived before their DB rows were committed.
 */
export async function reprocessUnprocessedWebhookEvents(options?: {
  paypal?: PayPalClient;
  now?: Date;
}): Promise<number> {
  const now = options?.now ?? new Date();
  const cutoff = new Date(now.getTime() - 60_000);

  const pending = await db
    .select()
    .from(webhookEvents)
    .where(
      and(
        isNull(webhookEvents.processedAt),
        lt(webhookEvents.createdAt, cutoff)
      )
    );

  let count = 0;
  for (const row of pending) {
    const event = row.payload as unknown as PayPalWebhookEnvelope;
    const processed = await dispatchWebhookEvent(event, options);
    if (processed) {
      await db
        .update(webhookEvents)
        .set({ processedAt: now })
        .where(eq(webhookEvents.id, row.id));
      count += 1;
    }
  }
  return count;
}
