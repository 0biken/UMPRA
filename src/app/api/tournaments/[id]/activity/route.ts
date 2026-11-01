import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { listTournamentActivity } from "@/server/audit";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const activity = await listTournamentActivity(id);
    return NextResponse.json({ activity });
  } catch (err) {
    return toErrorResponse(err);
  }
}
