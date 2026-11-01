import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { verifyAndCaptureEntryOrder } from "@/server/paypal/orders";
import { tick } from "@/server/agent/tick";

export async function GET(req: NextRequest) {
  const entryId = req.nextUrl.searchParams.get("entry") ?? "";
  const token = req.nextUrl.searchParams.get("token");

  if (!entryId) {
    return NextResponse.redirect(
      new URL("/play?payment=missing_entry", env.APP_URL)
    );
  }

  try {
    const outcome = await verifyAndCaptureEntryOrder(entryId, {
      tokenOrderId: token,
    });

    // Trigger agent tick after capture
    try {
      await tick(outcome.tournamentId);
    } catch (tickErr) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "Agent tick after payment return failed",
          tournamentId: outcome.tournamentId,
          error: tickErr instanceof Error ? tickErr.message : String(tickErr),
        })
      );
    }

    const bannerParam =
      outcome.status === "overflow_refunded"
        ? "overflow_refunded"
        : "paid";

    return NextResponse.redirect(
      new URL(
        `/t/${outcome.tournamentId}?payment=${bannerParam}`,
        env.APP_URL
      )
    );
  } catch {
    return NextResponse.redirect(
      new URL("/play?payment=failed", env.APP_URL)
    );
  }
}
