import { readJson } from "@/server/input";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireTournamentHost } from "@/server/auth/guards";
import {
  getTournamentDetails,
  updateTournamentTerms,
} from "@/server/tournament/service";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const details = await getTournamentDetails(id, db, (await getSession())?.id);
    return NextResponse.json(details, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req);
    const { id } = await context.params;
    const { user } = await requireTournamentHost(id);
    const parsed = z.object({ title: z.string().min(3).max(80).optional(), game: z.string().min(2).max(60).optional(), entryFeeCents: z.number().int().min(100).max(2000).optional(), payoutSplit: z.record(z.string(), z.number().int().positive()).optional() }).strict().safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("VALIDATION", "Invalid tournament changes.", 400, parsed.error.flatten());
    const body = parsed.data;
    const updated = await updateTournamentTerms(user.id, id, body);
    return NextResponse.json({ tournament: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
