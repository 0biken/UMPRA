import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { HttpPayPalClient } from "@/server/paypal/client";
import { newId } from "@/lib/ids";
import { env } from "@/server/env";

async function main() {
  const rl = readline.createInterface({ input:stdin, output:stdout });
  try {
    const client = new HttpPayPalClient();
    const entryId = newId();
    const order = await client.createOrder({ entryId, tournamentTitle:"Umpra sandbox verification", amountCents:100, returnUrl:env.APP_URL, cancelUrl:env.APP_URL, requestId:`sandbox-order-${entryId}` });
    console.log(`Approve this $1 sandbox order: ${order.approveUrl}`);
    console.log(`Order ID: ${order.orderId}`);
    if (process.argv.includes("--order-only")) { console.log("After approval, set SANDBOX_APPROVED_ORDER_ID to this order ID and run npm run test:sandbox with RUN_SANDBOX_TESTS=1."); return; }
    await rl.question("Approve in your sandbox personal account, then press Enter here: ");
    const details = await client.getOrder(order.orderId);
    if (details.status !== "APPROVED") throw new Error(`Order is ${details.status}; approval has not completed.`);
    const cap = await client.captureOrder(order.orderId, `sandbox-capture-${entryId}`);
    if (cap.amountCents !== 100 || cap.status !== "COMPLETED") throw new Error("Sandbox capture did not complete for $1.");
    console.log(`Captured $1. Capture ID: ${cap.captureId}`);
    const receiverEmail = (await rl.question("Sandbox personal email to receive the $1 payout: ")).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiverEmail)) throw new Error("A sandbox personal recipient email is required; payout verification is incomplete.");
    const batch = await client.createPayoutBatch({ senderBatchId:`sandbox-check-${entryId}`, emailSubject:"Umpra sandbox check", emailMessage:"Sandbox only", items:[{ senderItemId:entryId, receiverEmail, amountCents:100, note:"Sandbox verification" }] });
    console.log(`Payout batch ID: ${batch.batchId}`);
    let succeeded = false;
    for (let i=0;i<24;i++) {
      const status = await client.getPayoutBatch(batch.batchId);
      const item = status.items[0];
      if (item?.transactionStatus === "SUCCESS") { succeeded=true; break; }
      if (item && ["FAILED","DENIED","BLOCKED","UNCLAIMED","RETURNED"].includes(item.transactionStatus)) throw new Error(`Payout verification failed (${item.transactionStatus}). Stop and report this; no simulated fallback is enabled.`);
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
    if (!succeeded) throw new Error("Payout did not settle within two minutes. Verification remains pending; inspect the batch before retrying.");
    const answer = await rl.question("Check both sandbox accounts. Did the $1 leave the buyer and arrive at the recipient? Type confirmed: ");
    if (answer.trim().toLowerCase() !== "confirmed") throw new Error("Human receipt confirmation remains pending.");
    console.log(JSON.stringify({ check:"T-031", confirmed:true, orderId:order.orderId, captureId:cap.captureId, batchId:batch.batchId }));
  } finally { rl.close(); }
}
main().catch(err=>{ console.error(err instanceof Error ? err.message : "Sandbox verification failed"); process.exitCode=1; });
