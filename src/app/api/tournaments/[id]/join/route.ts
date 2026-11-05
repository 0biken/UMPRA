import { readJson } from "@/server/input";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import { joinTournamentAndCreateOrder } from "@/server/paypal/orders";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const user = await requireUser("player");
    const { id: tournamentId } = await context.params;
    const body = (await readJson(req)) as {
      gamertag?: string;
      paypalEmail?: string;
    };

    const result = await joinTournamentAndCreateOrder({
      tournamentId,
      playerId: user.id,
      gamertag: body.gamertag ?? "",
      paypalEmail: body.paypalEmail ?? user.paypalEmail ?? "",
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
