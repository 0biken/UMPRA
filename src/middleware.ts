import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import type { UserRole } from "@/server/db/schema";

export type RouteAccessDecision =
  | { action: "allow" }
  | { action: "redirect"; destination: string };

export function evaluateRouteAccess(
  pathname: string,
  search: string,
  session: { sub: string; role: UserRole } | null
): RouteAccessDecision {
  const isHostRoute = pathname === "/host" || pathname.startsWith("/host/");
  const isPlayRoute = pathname === "/play" || pathname.startsWith("/play/");

  if (!isHostRoute && !isPlayRoute) {
    return { action: "allow" };
  }

  const requiredRole: UserRole = isHostRoute ? "host" : "player";
  const nextTarget = `${pathname}${search || ""}`;

  if (!session) {
    return {
      action: "redirect",
      destination: `/login?next=${encodeURIComponent(nextTarget)}`,
    };
  }

  if (session.role !== requiredRole) {
    return {
      action: "redirect",
      destination: `/wrong-role?required=${requiredRole}&current=${session.role}&next=${encodeURIComponent(nextTarget)}`,
    };
  }

  return { action: "allow" };
}

async function verifyCookieInEdge(
  token: string | undefined
): Promise<{ sub: string; role: UserRole } | null> {
  if (!token) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      { algorithms: ["HS256"] }
    );
    if (
      typeof payload.sub === "string" &&
      (payload.role === "host" || payload.role === "player")
    ) {
      return { sub: payload.sub, role: payload.role };
    }
    return null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await verifyCookieInEdge(token);
  const decision = evaluateRouteAccess(
    req.nextUrl.pathname,
    req.nextUrl.search,
    session
  );

  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.destination, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/host/:path*", "/play/:path*"],
};
