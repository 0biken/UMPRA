import { z } from "zod";
import { eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import { env } from "@/server/env";
import { db, users, type UserRole } from "@/server/db";
import { hashPassword, verifyPassword } from "./password";
import { signSession, toPublicUser, type SessionUser } from "./session";

export const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(72, "Password must be at most 72 characters."),
  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters.")
    .max(40, "Display name must be at most 40 characters."),
  role: z.enum(["host", "player"], {
    errorMap: () => ({ message: "Choose either host or player." }),
  }),
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password.").max(72),
});

export const demoLoginSchema = z.object({
  role: z.enum(["host", "player"], {
    errorMap: () => ({ message: "Choose either host or player." }),
  }),
});

const INVALID_CREDENTIALS_MESSAGE =
  "Incorrect email or password. Check your details and try again.";

// Dummy hash so unknown-email login still runs bcrypt compare (constant-time defense)
const DUMMY_PASSWORD_HASH =
  "$2b$10$CwTycUXWue0Thq9StjUM0uJ8D0R6V5B5n4zL2M8P9Q1R2S3T4U5V6";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;

interface RateBucket {
  count: number;
  resetAt: number;
}

const loginBuckets = new Map<string, RateBucket>();

export function resetLoginRateLimits(): void {
  loginBuckets.clear();
}

function checkAndIncrementRateLimit(key: string, now = Date.now()): void {
  const bucket = loginBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    loginBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  if (bucket.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many sign-in attempts. Wait 15 minutes and try again.",
      429
    );
  }
  bucket.count += 1;
}

export async function registerUser(input: unknown): Promise<{
  user: SessionUser;
  token: string;
}> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const firstMsg =
      parsed.error.issues[0]?.message ?? "Check your registration details.";
    throw new AppError("VALIDATION", firstMsg, 400, parsed.error.flatten());
  }

  const { email, password, displayName, role } = parsed.data;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    throw new AppError(
      "EMAIL_TAKEN",
      "An account with this email already exists. Sign in instead.",
      409
    );
  }

  const passwordHash = await hashPassword(password);

  try {
    const [created] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        displayName,
        role,
      })
      .returning();

    const user = toPublicUser(created);
    const token = await signSession({ id: user.id, role: user.role });
    return { user, token };
  } catch (err) {
    // Handle race condition on unique email constraint
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new AppError(
        "EMAIL_TAKEN",
        "An account with this email already exists. Sign in instead.",
        409
      );
    }
    throw err;
  }
}

export async function loginUser(
  input: unknown,
  clientIp = "unknown"
): Promise<{ user: SessionUser; token: string }> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    const firstMsg =
      parsed.error.issues[0]?.message ?? "Enter your email and password.";
    throw new AppError("VALIDATION", firstMsg, 400, parsed.error.flatten());
  }

  const { email, password } = parsed.data;
  checkAndIncrementRateLimit(`ip:${clientIp}`);
  checkAndIncrementRateLimit(`email:${email}`);

  const [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!userRow) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    throw new AppError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE, 401);
  }

  const valid = await verifyPassword(password, userRow.passwordHash);
  if (!valid) {
    throw new AppError("INVALID_CREDENTIALS", INVALID_CREDENTIALS_MESSAGE, 401);
  }

  const user = toPublicUser(userRow);
  const token = await signSession({ id: user.id, role: user.role });
  return { user, token };
}

export async function loginDemoUser(
  input: unknown,
  demoModeOverride?: boolean
): Promise<{ user: SessionUser; token: string }> {
  const isDemoEnabled = demoModeOverride ?? env.DEMO_MODE;
  if (!isDemoEnabled) {
    throw new AppError("NOT_FOUND", "Not found.", 404);
  }

  const parsed = demoLoginSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      "VALIDATION",
      "Specify role as 'host' or 'player'.",
      400
    );
  }

  const role: UserRole = parsed.data.role;
  const email =
    role === "host" ? "demo-host@umpra.test" : "demo-player-1@umpra.test";
  const displayName = role === "host" ? "Tunde (Demo Host)" : "Kemi (Demo Player)";
  const paypalEmail =
    role === "player" ? "sb-player1@personal.example.com" : null;

  let [userRow] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!userRow) {
    const passwordHash = await hashPassword("umpra-demo-2026");
    [userRow] = await db
      .insert(users)
      .values({
        email,
        passwordHash,
        displayName,
        role,
        paypalEmail,
        isDemo: true,
      })
      .returning();
  }

  const user = toPublicUser(userRow);
  const token = await signSession({ id: user.id, role: user.role });
  return { user, token };
}
