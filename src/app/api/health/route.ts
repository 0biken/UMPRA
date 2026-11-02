import { NextResponse } from "next/server";
import { env } from "@/server/env";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "umpra",
    paypalEnv: env.PAYPAL_ENV,
    demoMode: env.DEMO_MODE,
    timestamp: new Date().toISOString(),
  });
}
