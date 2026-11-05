import { readJson } from "@/server/input";
import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import { parseTournamentPrompt } from "@/server/agent/parse-tournament";

const parseBodySchema = z.object({
  prompt: z
    .string({ error: "Enter a tournament description to parse." })
    .max(1000, "Description must be at most 1000 characters."),
});

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser("host");
    if (user.role !== "host") {
      throw new AppError(
        "FORBIDDEN",
        "Only tournament hosts can parse tournament configurations.",
        403
      );
    }

    const body = await readJson(req);
    const parsed = parseBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(
        "VALIDATION",
        parsed.error.issues[0]?.message ?? "Invalid tournament description.",
        400
      );
    }

    const result = await parseTournamentPrompt(parsed.data.prompt);
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
