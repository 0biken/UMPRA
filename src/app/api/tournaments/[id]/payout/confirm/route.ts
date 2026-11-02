import { z } from "zod";
import { AppError } from "@/lib/errors";
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

    const text = await req.text();
    let body: unknown = {};
    try { body = text ? JSON.parse(text) : {}; } catch { throw new AppError("VALIDATION", "Invalid JSON confirmation.", 400); }
    const parsed = z.object({ retryPayoutId: z.string().uuid().optional() }).strict().safeParse(body);
    if (!parsed.success) throw new AppError("VALIDATION", "Invalid payout confirmation.", 400);
    const retryPayoutId = parsed.data.retryPayoutId;

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
