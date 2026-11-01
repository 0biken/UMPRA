import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import {
  assertSameOrigin,
  requireTournamentHost,
} from "@/server/auth/guards";
import {
  confirmAndSendTournamentPayout,
  retryFailedPayoutItem,
} from "@/server/paypal/payouts";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req, { allowEmptyBody: true });
    const { id } = await context.params;
    const { user } = await requireTournamentHost(id);

    let retryPayoutId: string | undefined;
    try {
      const text = await req.text();
      if (text) {
        const body = JSON.parse(text) as { retryPayoutId?: string };
        retryPayoutId = body.retryPayoutId;
      }
    } catch {
      // empty body is valid for standard confirm
    }

    if (retryPayoutId) {
      const payouts = await retryFailedPayoutItem(user.id, id, retryPayoutId);
      return NextResponse.json({ payouts, retried: true });
    }

    const result = await confirmAndSendTournamentPayout(user.id, id);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
