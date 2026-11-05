import { describe, expect, it } from "vitest";

describe.skipIf(process.env.RUN_SANDBOX_TESTS !== "1")("real PayPal sandbox (manual approval prerequisite)", () => {
  it("captures a pre-approved order once, refunds it, and pays a recipient with a deduplicated batch", async () => {
    const { HttpPayPalClient } = await import("@/server/paypal/client");
    const { newId } = await import("@/lib/ids");
    const client = new HttpPayPalClient();
    const approvedId = process.env.SANDBOX_APPROVED_ORDER_ID;
    const receiver = process.env.SANDBOX_PAYOUT_RECIPIENT;
    expect(approvedId, "Approve a $1 order and set SANDBOX_APPROVED_ORDER_ID").toBeTruthy();
    expect(receiver, "Set SANDBOX_PAYOUT_RECIPIENT to a sandbox personal account").toBeTruthy();
    const created = await client.createOrder({ entryId: newId(), tournamentTitle:"Sandbox integration", amountCents:100, requestId:`test-order-${newId()}`, returnUrl:"http://localhost:3000", cancelUrl:"http://localhost:3000" });
    expect((await client.getOrder(created.orderId)).amountCents).toBe(100);
    const approved = await client.getOrder(approvedId!);
    expect(["APPROVED","COMPLETED"]).toContain(approved.status); expect(approved.amountCents).toBe(100);
    const cap = await client.captureOrder(approvedId!, `sandbox-capture-${approvedId}`);
    expect(cap.amountCents).toBe(100);
    const refundKey = `sandbox-refund-${cap.captureId}`;
    const refund = await client.refundCapture(cap.captureId, refundKey);
    expect((await client.refundCapture(cap.captureId, refundKey)).refundId).toBe(refund.refundId);
    const run = newId();
    const input = { senderBatchId:`sandbox-test-${run}`, emailSubject:"Umpra sandbox verification", emailMessage:"Test payout", items:[{ senderItemId:run, receiverEmail:receiver!, amountCents:100, note:"Sandbox only" }] };
    const batch = await client.createPayoutBatch(input);
    // Real PayPal may reject duplicate sender_batch_id rather than return the original response.
    try { const dup = await client.createPayoutBatch(input); expect(dup.batchId).toBe(batch.batchId); }
    catch (err) { expect(err).toMatchObject({ code:"PAYPAL_ERROR" }); }
    let details = await client.getPayoutBatch(batch.batchId);
    for (let i=0;i<24 && details.items.some(x=>x.transactionStatus === "PENDING");i++) {
      await new Promise(resolve=>setTimeout(resolve,5000)); details=await client.getPayoutBatch(batch.batchId);
    }
    expect(details.items).toHaveLength(1);
    expect(details.items[0].transactionStatus).toBe("SUCCESS");
  });
});
