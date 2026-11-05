import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSweepSecret } from "@/server/agent/auth";
import { sweepActiveTournaments } from "@/server/agent/tick";

export async function POST(req: Request) {
  try {
    assertSweepSecret(req);
    const result = await sweepActiveTournaments();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
