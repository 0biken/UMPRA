import { readJson } from "@/server/input";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import {
  assertDemoModeEnabled,
  submitDemoMatchScreenshots,
} from "@/server/demo/service";

const submitSchema = z.object({
  matchId: z.string().uuid("Invalid match ID."),
  scenario: z
    .enum(["agree", "mismatch", "unreadable", "wrong_players"])
    .default("agree"),
});

export async function POST(req: Request) {
  try {
    assertDemoModeEnabled();
    assertSameOrigin(req);
    const user = await requireUser("host");

    const body = await readJson(req);
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION",
        parsed.error.issues[0]?.message ?? "Invalid request body.",
        400
      );
    }

    const result = await submitDemoMatchScreenshots(parsed.data, user.id);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
