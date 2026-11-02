import { readJson } from "@/server/input";
import { z } from "zod";
import { tournamentConfigSchema } from "@/server/tournament/config";
import { NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, requireUser } from "@/server/auth/guards";
import {
  createTournament,
  listTournaments,
  openTournament,
} from "@/server/tournament/service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const requestedHost = url.searchParams.get("hostId");
    const hostId = requestedHost ? (await requireUser("host")).id : undefined;
    const onlyOpen = url.searchParams.get("public") === "1";

    const items = await listTournaments({
      hostId,
      onlyOpenOrActive: onlyOpen || !hostId,
    });

    return NextResponse.json({ tournaments: items });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const user = await requireUser("host");
    if (user.role !== "host") {
      throw new AppError(
        "FORBIDDEN",
        "Only tournament hosts can create tournaments.",
        403
      );
    }

    const parsed = tournamentConfigSchema.extend({ openImmediately: z.boolean().default(false) }).safeParse(await readJson(req));
    if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0].message, 400, parsed.error.flatten());
    const body = parsed.data;
    const openImmediately = body.openImmediately;

    let tournament = await createTournament(user.id, body);
    if (openImmediately) {
      tournament = await openTournament(user.id, tournament.id);
    }

    return NextResponse.json({ tournament }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
