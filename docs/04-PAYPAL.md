# 04 — PayPal integration

Sandbox only. Base URL `https://api-m.sandbox.paypal.com`. This document describes the intended calls; **before coding each one, confirm field names against the current reference** (Orders v2 `developer.paypal.com/docs/api/orders/v2/`, Payouts `developer.paypal.com/docs/api/payments.payouts-batch/v1/`, Webhooks `developer.paypal.com/docs/api/webhooks/v1/`, Agent Toolkit `developer.paypal.com/ai-tools/toolkit`). If the reference and this file differ, trust the reference and fix this file.

## Setup (human, once)

1. PayPal Developer Dashboard, create a sandbox REST app. Copy client id and secret into env.
2. Sandbox accounts: one **business** account (the platform; receives entry fees and sends payouts) and at least nine **personal** accounts (one buyer for judges, eight for demo players and payout recipients). Record emails in `09`.
3. Confirm the business account can use Payouts and holds sandbox balance (task T-031).
4. Create a webhook on the app pointing at `<APP_URL>/api/paypal/webhook` with the events listed below; copy its id to `PAYPAL_WEBHOOK_ID`.

## Client (`src/server/paypal/client.ts`)

- `getAccessToken()`: `POST /v1/oauth2/token`, HTTP Basic (`client_id:secret`), form body `grant_type=client_credentials`. Cache in memory until shortly before expiry.
- `request(method, path, { body, requestId })`: adds `Authorization: Bearer`, `Content-Type: application/json`, and `PayPal-Request-Id` when `requestId` is given. Maps non-2xx to `AppError('PAYPAL_ERROR', ...)`, logs `PayPal-Debug-Id`.
- Define a `PayPalClient` interface covering the functions below, so tests use `FakePayPal` and the sandbox suite uses the real one.

## Entry fee flow (redirect checkout)

```
Player clicks "Pay $5"
 → POST /api/tournaments/:id/join          (reserve slot, create entry + payment rows)
     → POST /v2/checkout/orders            (PayPal-Request-Id: entry-<entryId>)
     ← order id + link rel "payer-action"
 → browser redirects to PayPal approval page
 → PayPal redirects to  <APP_URL>/api/paypal/return?entry=<entryId>&token=<orderId>
     → GET  /v2/checkout/orders/<orderId>  (verify status APPROVED, amount, reference)
     → POST /v2/checkout/orders/<orderId>/capture   (PayPal-Request-Id: capture-<entryId>)
     ← capture id, status COMPLETED
     → mark payment captured, entry paid, audit, tick()
 → redirect to the tournament page with a result banner
```

Create order request shape:

```json
{
  "intent": "CAPTURE",
  "purchase_units": [{
    "reference_id": "<entryId>",
    "custom_id": "<entryId>",
    "description": "Umpra entry: <tournament title>",
    "amount": { "currency_code": "USD", "value": "5.00" }
  }],
  "payment_source": {
    "paypal": {
      "experience_context": {
        "return_url": "<APP_URL>/api/paypal/return?entry=<entryId>",
        "cancel_url": "<APP_URL>/api/paypal/cancel?entry=<entryId>",
        "user_action": "PAY_NOW",
        "shipping_preference": "NO_SHIPPING"
      }
    }
  }
}
```

Return handler rules:

1. Load the entry and payment from the DB by `entry`; ignore any amount or tournament info in the URL.
2. `GET` the order. Require `status` of `APPROVED` (or already `COMPLETED` for a refresh), the `custom_id` equal to the entry id, and the amount equal to the tournament fee. Anything else marks the payment `failed` and shows an error.
3. Capture with the deterministic request id. If the payment is already `captured`, skip the call and just redirect (refresh safety).
4. After capture, run the overflow check (T-036): if the tournament is no longer `open` or is over capacity, refund immediately and tell the player.
5. Record `state_at_capture`.

Cancel handler: mark the entry `cancelled`, payment `failed`, free the slot, redirect with a "Payment cancelled" banner.

## Refunds

`POST /v2/payments/captures/<captureId>/refund` with `PayPal-Request-Id: refund-<paymentId>`; omit the body for a full refund. Mark `refund_pending`, then `refunded` on success or on the `PAYMENT.CAPTURE.REFUNDED` webhook. Refund triggers: tournament cancelled, deadline passed unfilled, overflow capture, late capture for an expired entry.

## Payout flow

```
Host confirms
 → tx: UPDATE payouts SET status='approved', approved_by, approved_at
        WHERE tournament_id=? AND status='drafted'      (compare-and-set)
 → if 0 rows updated: already approved; return current status, send nothing
 → POST /v1/payments/payouts
 ← batch id
 → store paypal_batch_id, status 'submitted'
 → webhooks / polling GET /v1/payments/payouts/<batchId> update each item
```

Request shape:

```json
{
  "sender_batch_header": {
    "sender_batch_id": "payout-<tournamentId>",
    "recipient_type": "EMAIL",
    "email_subject": "You won on Umpra",
    "email_message": "Your prize from <tournament title> has been paid."
  },
  "items": [
    { "amount": { "value": "28.00", "currency": "USD" },
      "sender_item_id": "<tournamentId>-1",
      "recipient_wallet": "PAYPAL",
      "receiver": "<winner paypal email>",
      "note": "1st place" }
  ]
}
```

Rules:

- Amounts come from the `payouts` rows, which come from `computePayouts`. Never from the model or the client.
- `sendPayoutBatch()` throws unless every row for the tournament is `approved`. This is the code-level checkpoint.
- Retrying after a timeout or 5xx reuses the **same** `sender_batch_id` and the same items. PayPal does not process duplicate batches, and the API doc notes a 5xx can be retried with the same batch id.
- Item outcomes: `succeeded`, `failed`, `unclaimed` (recipient has no PayPal account for that email). The tournament becomes `paid` only when every item has succeeded. A failed item shows a retry action for that recipient; the retry creates a new batch with a new `sender_batch_id` suffix (`payout-<tournamentId>-retry-<n>`) containing only that item, and only after the host confirms again.
- If `receiver` is missing or malformed at draft time (player has no PayPal email), the draft is blocked with a message to the host.

## Webhooks

Endpoint `POST /api/paypal/webhook`:

1. Read the **raw body text** (`await req.text()`), then `JSON.parse`. Verification must use the exact event.
2. Verify with `POST /v1/notifications/verify-webhook-signature`, sending `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` (from the `paypal-*` headers), `webhook_id`, and `webhook_event`. Require `verification_status: "SUCCESS"`. Otherwise return 400 and store nothing as processed.
3. Insert into `webhook_events` using the event id as primary key. A duplicate returns 200 and does nothing.
4. Dispatch by `event_type` to idempotent handlers (below). Always return 200 quickly after storing; handlers must tolerate arriving before or after the synchronous API result.
5. Mark `processed_at`.

| Event | Handler |
|-------|---------|
| `CHECKOUT.ORDER.APPROVED` | log only; capture happens on the return route |
| `PAYMENT.CAPTURE.COMPLETED` | if the payment is not yet `captured`, mark it captured (reconciliation) |
| `PAYMENT.CAPTURE.DENIED` | mark payment `failed`, free the slot |
| `PAYMENT.CAPTURE.REFUNDED` | mark payment `refunded`, entry `refunded` |
| `PAYMENT.PAYOUTSBATCH.SUCCESS` / `DENIED` | update batch status |
| `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` / `FAILED` / `UNCLAIMED` | update the payout item by `sender_item_id` |

Out-of-order rule: handlers look up by PayPal ids stored on our rows. If the row is not found yet (webhook beat our write), return 200 after storing the event unprocessed; the sweep reprocesses unprocessed events older than a minute.

## Agent tools over PayPal

The agent never calls `fetch` against PayPal. It calls registry tools (`05 §Tools`) that wrap this service: `paypal.getOrder`, `paypal.captureOrder`, `paypal.refundCapture`, `paypal.createPayoutBatch`, `paypal.getPayoutBatch`. Task T-070 evaluates `@paypal/agent-toolkit` (TypeScript, sandbox mode via `context: { sandbox: true }`, Node 18+) as the implementation behind the order and capture tools, which supports the "Best Use of PayPal + AI" and "Agentic Commerce" angles. Record the outcome here:

> Decision (fill in at T-070): _pending_

## Fallback if Payouts is unavailable in the sandbox

Stop and ask the human. The agreed fallback is a `PayoutProvider` interface with a `SimulatedPayouts` implementation (a sandbox account-to-account transfer or a recorded simulated result), clearly labeled "Simulated payout" in the UI, README, and video. The host checkpoint, ledger, audit log, and idempotency behave identically.

## Sandbox facts to remember

Buyers approving a payment must log into a sandbox **personal** account on the PayPal sandbox page. Webhooks need a public URL. The sandbox webhook simulator sends events that do not pass real signature verification, so test verification with real sandbox events on the deployed app, and test handler logic with `FakePayPal` and `PAYPAL_WEBHOOK_VERIFY=false` in unit tests only.
