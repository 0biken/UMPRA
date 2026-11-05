import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { getTournamentDetails } from "@/server/tournament/service";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const { activity } = await getTournamentDetails(id, db, (await getSession())?.id);
    return NextResponse.json({ activity }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return toErrorResponse(err);
  }
}
