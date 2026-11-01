import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import {
  getSessionFromToken,
  signSession,
  verifySession,
} from "@/server/auth/session";
import { assertSameOrigin } from "@/server/auth/guards";
import {
  loginDemoUser,
  loginUser,
  registerUser,
  resetLoginRateLimits,
} from "@/server/auth/service";
import { evaluateRouteAccess } from "@/middleware";
import {
  closeDatabase,
  resetTestDatabase,
  users,
  type AppDatabase,
} from "@/server/db";
import { AppError } from "@/lib/errors";

describe("auth core, routes, protection, and demo login (T-010 to T-014)", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = await resetTestDatabase();
    resetLoginRateLimits();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("hashes and verifies passwords with bcrypt", async () => {
    const hash = await hashPassword("correct-horse-battery");
    expect(hash).not.toBe("correct-horse-battery");
    expect(await verifyPassword("correct-horse-battery", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("signs and verifies valid JWT session tokens", async () => {
    const token = await signSession({
      id: "11111111-1111-4111-8111-111111111111",
      role: "host",
    });
    const verified = await verifySession(token);
    expect(verified).toEqual({
      sub: "11111111-1111-4111-8111-111111111111",
      role: "host",
    });
  });

  it("rejects tampered or expired session cookies (EC-A2)", async () => {
    const token = await signSession({
      id: "11111111-1111-4111-8111-111111111111",
      role: "player",
    });
    const tampered = `${token.slice(0, -4)}xxxx`;
    expect(await verifySession(tampered)).toBeNull();

    const expired = await signSession(
      {
        id: "11111111-1111-4111-8111-111111111111",
        role: "player",
      },
      { expiresInSeconds: -10 }
    );
    expect(await verifySession(expired)).toBeNull();
  });

  it("loads user row on session verification and invalidates deleted users", async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: "player@umpra.test",
        passwordHash: "hash",
        displayName: "Player One",
        role: "player",
      })
      .returning();

    const token = await signSession({ id: user.id, role: user.role });
    const sessionUser = await getSessionFromToken(token);
    expect(sessionUser?.id).toBe(user.id);
    expect(sessionUser).not.toHaveProperty("passwordHash");

    await db.delete(users);
    expect(await getSessionFromToken(token)).toBeNull();
  });

  it("registers a new user, rejects duplicate emails clearly, and never returns passwordHash (T-011)", async () => {
    const { user, token } = await registerUser({
      email: "  Kemi@Umpra.Test ",
      password: "strong-password-123",
      displayName: "Kemi",
      role: "player",
    });

    expect(user.email).toBe("kemi@umpra.test");
    expect(user.role).toBe("player");
    expect(user).not.toHaveProperty("passwordHash");
    expect(token).toBeTruthy();

    await expect(
      registerUser({
        email: "kemi@umpra.test",
        password: "another-password-123",
        displayName: "Kemi Two",
        role: "host",
      })
    ).rejects.toMatchObject({
      code: "EMAIL_TAKEN",
      status: 409,
    });
  });

  it("returns identical error on bad email vs bad password and rate-limits after 10 attempts (T-011)", async () => {
    await registerUser({
      email: "host@umpra.test",
      password: "correct-password-123",
      displayName: "Host",
      role: "host",
    });

    let badEmailErr: AppError | null = null;
    let badPassErr: AppError | null = null;

    try {
      await loginUser({
        email: "nobody@umpra.test",
        password: "correct-password-123",
      });
    } catch (e) {
      badEmailErr = e as AppError;
    }

    try {
      await loginUser({
        email: "host@umpra.test",
        password: "wrong-password-123",
      });
    } catch (e) {
      badPassErr = e as AppError;
    }

    expect(badEmailErr).toBeInstanceOf(AppError);
    expect(badPassErr).toBeInstanceOf(AppError);
    expect(badEmailErr?.code).toBe("INVALID_CREDENTIALS");
    expect(badPassErr?.code).toBe("INVALID_CREDENTIALS");
    expect(badEmailErr?.message).toBe(badPassErr?.message);

    // Rate limit check: 10 attempts per IP allowed, 11th rejected with 429
    resetLoginRateLimits();
    for (let i = 0; i < 10; i++) {
      await expect(
        loginUser(
          { email: `user${i}@umpra.test`, password: "wrong-password" },
          "10.0.0.1"
        )
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(
      loginUser(
        { email: "host@umpra.test", password: "correct-password-123" },
        "10.0.0.1"
      )
    ).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it("protects /host/** and /play/** routes and rejects cross-origin POSTs (T-013, EC-A1, EC-A3)", () => {
    // Unauthenticated user on /host/new redirects to /login?next=...
    expect(evaluateRouteAccess("/host/new", "", null)).toEqual({
      action: "redirect",
      destination: "/login?next=%2Fhost%2Fnew",
    });

    // Wrong role (player accessing /host) redirects to /wrong-role
    expect(
      evaluateRouteAccess("/host", "", { sub: "u1", role: "player" })
    ).toEqual({
      action: "redirect",
      destination: "/wrong-role?required=host&current=player&next=%2Fhost",
    });

    // Wrong role (host accessing /play) redirects to /wrong-role
    expect(
      evaluateRouteAccess("/play", "", { sub: "u2", role: "host" })
    ).toEqual({
      action: "redirect",
      destination: "/wrong-role?required=player&current=host&next=%2Fplay",
    });

    // Matching role is allowed
    expect(
      evaluateRouteAccess("/host", "", { sub: "u2", role: "host" })
    ).toEqual({ action: "allow" });

    // Cross-origin check
    const goodReq = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
    });
    expect(() => assertSameOrigin(goodReq)).not.toThrow();

    const badOriginReq = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        origin: "https://evil.example.com",
        "content-type": "application/json",
      },
    });
    expect(() => assertSameOrigin(badOriginReq)).toThrow(AppError);
  });

  it("allows demo login only when DEMO_MODE=true and returns 404 when DEMO_MODE=false (T-014, EC-A4)", async () => {
    await expect(
      loginDemoUser({ role: "host" }, false)
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });

    const hostDemo = await loginDemoUser({ role: "host" }, true);
    expect(hostDemo.user.role).toBe("host");
    expect(hostDemo.user.isDemo).toBe(true);

    const playerDemo = await loginDemoUser({ role: "player" }, true);
    expect(playerDemo.user.role).toBe("player");
    expect(playerDemo.user.isDemo).toBe(true);
  });
});
