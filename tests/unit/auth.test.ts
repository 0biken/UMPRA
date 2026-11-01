import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import {
  getSessionFromToken,
  signSession,
  verifySession,
} from "@/server/auth/session";
import { assertSameOrigin } from "@/server/auth/guards";
import {
  closeDatabase,
  resetTestDatabase,
  users,
  type AppDatabase,
} from "@/server/db";
import { AppError } from "@/lib/errors";

describe("auth core (T-010 & T-013)", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = await resetTestDatabase();
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

    // Delete user -> token must no longer resolve a session
    await db.delete(users);
    expect(await getSessionFromToken(token)).toBeNull();
  });

  it("rejects cross-origin POST requests (EC-A3)", () => {
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

    const missingOriginReq = new Request("http://localhost:3000/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    expect(() => assertSameOrigin(missingOriginReq)).toThrow(AppError);
  });
});
