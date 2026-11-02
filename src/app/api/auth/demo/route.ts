import { readJson } from "@/server/input";
import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin } from "@/server/auth/guards";
import { loginDemoUser } from "@/server/auth/service";
import { setSessionCookie } from "@/server/auth/session";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const body = await readJson(req);
    const { user, token } = await loginDemoUser(body);
    await setSessionCookie(token);
    return NextResponse.json({ user });
  } catch (err) {
    return toErrorResponse(err);
  }
}
