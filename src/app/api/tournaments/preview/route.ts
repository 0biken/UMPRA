import { readJson } from "@/server/input";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import { validateTournamentConfig } from "@/server/tournament/config";
import { computePayouts } from "@/server/tournament/payout-math";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    await requireUser("host");
    const config = validateTournamentConfig(await readJson(req));
    const projectedPoolCents = config.slots * config.entryFeeCents;
    return NextResponse.json({ projectedPoolCents, payouts: computePayouts(projectedPoolCents, config.payoutSplit) });
  } catch (err) { return toErrorResponse(err); }
}
