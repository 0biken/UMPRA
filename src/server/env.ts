import { z } from "zod";

const booleanString = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === "") return defaultValue;
      return val.toLowerCase() === "true" || val === "1";
    });

export const envSchema = z.object({
  APP_URL: z.string().url("APP_URL must be a valid URL"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),

  PAYPAL_ENV: z.literal("sandbox", {
    errorMap: () => ({
      message: "PAYPAL_ENV must be 'sandbox' (production is forbidden)",
    }),
  }),
  PAYPAL_CLIENT_ID: z.string().min(1, "PAYPAL_CLIENT_ID is required"),
  PAYPAL_CLIENT_SECRET: z.string().min(1, "PAYPAL_CLIENT_SECRET is required"),
  PAYPAL_WEBHOOK_ID: z.string().min(1, "PAYPAL_WEBHOOK_ID is required"),
  PAYPAL_WEBHOOK_VERIFY: booleanString(true),

  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  VISION_MODEL: z
    .string()
    .optional()
    .transform((val) => (val && val.trim().length > 0 ? val.trim() : "claude-sonnet-5-5")),

  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  SUPABASE_BUCKET: z.string().min(1, "SUPABASE_BUCKET is required"),

  AGENT_SWEEP_SECRET: z.string().min(1, "AGENT_SWEEP_SECRET is required"),
  DEMO_MODE: booleanString(false),
  MATCH_TIMEOUT_MIN: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  SECOND_SUBMISSION_TIMEOUT_MIN: z.coerce
    .number()
    .int()
    .positive()
    .default(15),
  RUN_SANDBOX_TESTS: z
    .string()
    .optional()
    .transform((val) => val === "1" || val?.toLowerCase() === "true"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export const env: Env = parseEnv(process.env);
