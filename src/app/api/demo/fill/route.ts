import { readJson } from "@/server/input";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import {
  assertDemoModeEnabled,
  fillTournamentWithDemoPlayers,
} from "@/server/demo/service";

const fillSchema = z.object({
  tournamentId: z.string().uuid("Invalid tournament ID."),
});

export async function POST(req: Request) {
  try {
    assertDemoModeEnabled();
    assertSameOrigin(req);
    const user = await requireUser("host");

    const body = await readJson(req);
    const parsed = fillSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION",
        parsed.error.issues[0]?.message ?? "Invalid request body.",
        400
      );
    }

    const result = await fillTournamentWithDemoPlayers(
      parsed.data.tournamentId, user.id
    );
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
