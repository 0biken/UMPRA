import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import { openTournament } from "@/server/tournament/service";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req, { allowEmptyBody: true });
    const user = await requireUser("host");
    const { id } = await context.params;
    const tournament = await openTournament(user.id, id);
    return NextResponse.json({ tournament });
  } catch (err) {
    return toErrorResponse(err);
  }
}
