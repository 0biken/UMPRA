import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { tick } from "@/server/agent/tick";
import { assertSweepSecret } from "@/app/api/agent/sweep/route";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSweepSecret(req);
    const { id } = await context.params;
    await tick(id);
    return NextResponse.json({ ok: true, tournamentId: id });
  } catch (err) {
    return toErrorResponse(err);
  }
}
