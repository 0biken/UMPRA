import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { AppError, toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import { db, matches } from "@/server/db";
import { submitMatchScreenshot } from "@/server/tournament/submissions";
import { tick } from "@/server/agent/tick";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(req, { allowMultipart: true });
    const user = await requireUser("player");
    const { id: matchId } = await context.params;

    const formData = await req.formData();
    const file = formData.get("screenshot") ?? formData.get("file");

    if (!file || !(file instanceof File)) {
      throw new AppError(
        "UPLOAD_REJECTED",
        "Attach a screenshot image file (PNG, JPEG, or WebP).",
        400
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const submission = await submitMatchScreenshot({
      matchId,
      playerId: user.id,
      bytes,
      mimeType: file.type,
    });

    const [match] = await db
      .select({ tournamentId: matches.tournamentId })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (match?.tournamentId) {
      try {
        await tick(match.tournamentId);
      } catch (tickErr) {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "Agent tick after submission failed",
            tournamentId: match.tournamentId,
            error: tickErr instanceof Error ? tickErr.message : String(tickErr),
          })
        );
      }
    }

    return NextResponse.json({ submission }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
