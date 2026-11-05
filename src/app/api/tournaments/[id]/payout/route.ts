import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { requireTournamentHost } from "@/server/auth/guards";
import { getPayoutReviewData } from "@/server/paypal/payouts";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await requireTournamentHost(id);
    const data = await getPayoutReviewData(id);
    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}
