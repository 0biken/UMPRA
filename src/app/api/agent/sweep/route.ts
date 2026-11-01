import { NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { env } from "@/server/env";
import { sweepActiveTournaments } from "@/server/agent/tick";

export function assertSweepSecret(req: Request): void {
  const provided =
    req.headers.get("x-sweep-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!provided || provided !== env.AGENT_SWEEP_SECRET) {
    throw new AppError(
      "UNAUTHENTICATED",
      "Missing or invalid agent sweep secret.",
      401
    );
  }
}

export async function POST(req: Request) {
  try {
    assertSweepSecret(req);
    const result = await sweepActiveTournaments();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return toErrorResponse(err);
  }
}
