import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "@/server/env";

const validBaseEnv: Record<string, string> = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/umpra",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  PAYPAL_ENV: "sandbox",
  PAYPAL_CLIENT_ID: "client-id",
  PAYPAL_CLIENT_SECRET: "client-secret",
  PAYPAL_WEBHOOK_ID: "webhook-id",
  GEMINI_API_KEY: "test-gemini-key",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_BUCKET: "screenshots",
  AGENT_SWEEP_SECRET: "sweep-secret",
};

describe("env validation (T-003)", () => {
  it("parses valid required env vars and applies defaults for optional vars", () => {
    const parsed = parseEnv(validBaseEnv);
    expect(parsed.APP_URL).toBe("http://localhost:3000");
    expect(parsed.PAYPAL_ENV).toBe("sandbox");
    expect(parsed.PAYPAL_WEBHOOK_VERIFY).toBe(true);
    expect(parsed.VISION_MODEL).toBe("gemini-flash-latest");
    expect(parsed.DEMO_MODE).toBe(false);
    expect(parsed.MATCH_TIMEOUT_MIN).toBe(30);
    expect(parsed.SECOND_SUBMISSION_TIMEOUT_MIN).toBe(15);
    expect(parsed.RUN_SANDBOX_TESTS).toBe(false);
  });

  it("throws fast when any required variable is missing", () => {
    const requiredKeys = Object.keys(validBaseEnv);
    for (const key of requiredKeys) {
      const incomplete = { ...validBaseEnv };
      delete incomplete[key];
      expect(() => parseEnv(incomplete)).toThrowError(
        new RegExp(`Invalid environment configuration.*${key}`)
      );
    }
  });

  it("forbids non-sandbox PAYPAL_ENV values", () => {
    expect(() =>
      parseEnv({ ...validBaseEnv, PAYPAL_ENV: "production" })
    ).toThrowError(/PAYPAL_ENV/);
    expect(() =>
      parseEnv({ ...validBaseEnv, PAYPAL_ENV: "live" })
    ).toThrowError(/PAYPAL_ENV/);
  });

  it("rejects SESSION_SECRET shorter than 32 characters", () => {
    expect(() =>
      parseEnv({ ...validBaseEnv, SESSION_SECRET: "too-short" })
    ).toThrowError(/SESSION_SECRET/);
  });

  it("fails on module import when process.env is missing a required var", async () => {
    vi.resetModules();
    const originalDbUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(import("@/server/env")).rejects.toThrowError(/DATABASE_URL/);
    } finally {
      process.env.DATABASE_URL = originalDbUrl;
      vi.resetModules();
    }
  });
});
