import readline from "readline";
import { HttpPayPalClient } from "@/server/paypal/client";
import { newId } from "@/lib/ids";

function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function main() {
  const client = new HttpPayPalClient();
  const entryId = newId();

  console.log("1. Fetching OAuth token and creating $1.00 sandbox order...");
  const order = await client.createOrder({
    entryId,
    tournamentTitle: "Sandbox Check Tournament",
    amountCents: 100,
    returnUrl: "http://localhost:3000/api/paypal/return",
    cancelUrl: "http://localhost:3000/api/paypal/cancel",
    requestId: `entry-${entryId}`,
  });

  console.log(`Order created: ${order.orderId}`);
  console.log(`Approve URL:   ${order.approveUrl}`);

  await askQuestion(
    "\nOpen the Approve URL above in a browser, sign in with a sandbox personal buyer account, approve the payment, then press Enter here..."
  );

  console.log("2. Fetching order status...");
  const details = await client.getOrder(order.orderId);
  console.log(`Order status: ${details.status}`);

  console.log("3. Capturing order...");
  const capture = await client.captureOrder(
    order.orderId,
    `capture-${entryId}`
  );
  console.log(`Captured: ${capture.captureId} (${capture.status})`);

  const receiverEmail = await askQuestion(
    "\nEnter a sandbox personal account email to receive a $1.00 test payout: "
  );
  if (!receiverEmail) {
    console.log("No receiver email entered; skipping payout check.");
    return;
  }

  const batchSenderId = `sandbox-check-${entryId}`;
  console.log(`4. Sending $1.00 payout batch (${batchSenderId})...`);
  const payout = await client.createPayoutBatch({
    senderBatchId: batchSenderId,
    emailSubject: "Umpra Sandbox Check",
    emailMessage: "Test $1.00 payout from Umpra sandbox check.",
    items: [
      {
        senderItemId: `${entryId}-1`,
        receiverEmail,
        amountCents: 100,
        note: "Sandbox verification payout",
      },
    ],
  });

  console.log(`Payout batch submitted: ${payout.batchId} (${payout.batchStatus})`);
}

main().catch((err) => {
  console.error("Sandbox check failed:", err);
  process.exit(1);
});
