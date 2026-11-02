import { readJson } from "@/server/input";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireTournamentHost } from "@/server/auth/guards";
import { retryFailedPayoutItem } from "@/server/paypal/payouts";

const retrySchema = z.object({
  payoutId: z.string().uuid("Invalid payout item ID."),
});

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const { id } = await context.params;
    const { user } = await requireTournamentHost(id);

    const body = await readJson(req);
    const parsed = retrySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION",
        parsed.error.issues[0]?.message ?? "Invalid retry request.",
        400
      );
    }

    const result = await retryFailedPayoutItem(user.id, id, parsed.data.payoutId);

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
