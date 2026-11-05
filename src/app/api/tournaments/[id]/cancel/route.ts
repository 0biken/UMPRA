import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import { cancelAndRefundTournament } from "@/server/paypal/refunds";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req, { allowEmptyBody: true });
    const user = await requireUser("host");
    const { id } = await context.params;

    let reason = "Cancelled by host";
    try {
      const text = await req.text();
      if (text) {
        const body = JSON.parse(text) as { reason?: string };
        if (body.reason) reason = body.reason;
      }
    } catch {
      // ignore empty body
    }

    const result = await cancelAndRefundTournament(user.id, id, reason);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
