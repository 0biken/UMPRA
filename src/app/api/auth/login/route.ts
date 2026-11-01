import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin } from "@/server/auth/guards";
import { loginUser } from "@/server/auth/service";
import { setSessionCookie } from "@/server/auth/session";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await req.json();
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const { user, token } = await loginUser(body, ip);
    await setSessionCookie(token);
    return NextResponse.json({ user });
  } catch (err) {
    return toErrorResponse(err);
  }
}
