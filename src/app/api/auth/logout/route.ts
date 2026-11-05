import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin } from "@/server/auth/guards";
import { clearSessionCookie } from "@/server/auth/session";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req, { allowEmptyBody: true });
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
