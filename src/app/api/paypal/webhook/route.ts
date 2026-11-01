import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { handlePayPalWebhook } from "@/server/paypal/webhooks";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const headers = {
      authAlgo: req.headers.get("paypal-auth-algo"),
      certUrl: req.headers.get("paypal-cert-url"),
      transmissionId: req.headers.get("paypal-transmission-id"),
      transmissionSig: req.headers.get("paypal-transmission-sig"),
      transmissionTime: req.headers.get("paypal-transmission-time"),
    };

    const result = await handlePayPalWebhook(rawBody, headers);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
