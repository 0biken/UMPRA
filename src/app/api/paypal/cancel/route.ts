import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { cancelEntryOrder } from "@/server/paypal/orders";

export async function GET(req: NextRequest) {
  const entryId = req.nextUrl.searchParams.get("entry") ?? "";
  if (!entryId) {
    return NextResponse.redirect(
      new URL("/play?payment=cancelled", env.APP_URL)
    );
  }

  try {
    const { tournamentId } = await cancelEntryOrder(entryId);
    return NextResponse.redirect(
      new URL(`/t/${tournamentId}?payment=cancelled`, env.APP_URL)
    );
  } catch {
    return NextResponse.redirect(
      new URL("/play?payment=cancelled", env.APP_URL)
    );
  }
}
