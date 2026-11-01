import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { env } from "@/server/env";
import { db, users, type UserRole } from "@/server/db";

export const SESSION_COOKIE_NAME = "umpra_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface SessionTokenPayload {
  sub: string;
  role: UserRole;
  exp?: number;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  paypalEmail: string | null;
  isDemo: boolean;
  createdAt: Date;
}

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function signSession(
  user: { id: string; role: UserRole },
  options?: { expiresInSeconds?: number }
): Promise<string> {
  const ttl = options?.expiresInSeconds ?? SESSION_MAX_AGE_SECONDS;
  const nowSec = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + ttl)
    .sign(getSecretKey());
}

export async function verifySession(
  token: string
): Promise<{ sub: string; role: UserRole } | null> {
  if (!token || typeof token !== "string") {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    const sub = payload.sub;
    const role = payload.role;
    if (
      typeof sub !== "string" ||
      !sub ||
      (role !== "host" && role !== "player")
    ) {
      return null;
    }
    return { sub, role };
  } catch {
    return null;
  }
}

export function toPublicUser(row: typeof users.$inferSelect): SessionUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    paypalEmail: row.paypalEmail ?? null,
    isDemo: row.isDemo,
    createdAt: row.createdAt,
  };
}

export async function getSessionFromToken(
  token: string | undefined | null
): Promise<SessionUser | null> {
  if (!token) return null;
  const verified = await verifySession(token);
  if (!verified) return null;

  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.id, verified.sub))
    .limit(1);

  if (!userRow || userRow.role !== verified.role) {
    return null;
  }
  return toPublicUser(userRow);
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getSessionFromToken(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
