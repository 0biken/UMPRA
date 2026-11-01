import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import { resolveDisputeByHost } from "@/server/tournament/disputes";
import { tick } from "@/server/agent/tick";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const user = await requireUser("host");
    const { id: disputeId } = await context.params;
    const body = await req.json();

    const result = await resolveDisputeByHost(user.id, disputeId, body);

    try {
      await tick(result.tournamentId);
    } catch (tickErr) {
      console.error(
        JSON.stringify({
          level: "error",
          msg: "Agent tick after dispute resolution failed",
          tournamentId: result.tournamentId,
          error: tickErr instanceof Error ? tickErr.message : String(tickErr),
        })
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
