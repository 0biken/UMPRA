import { z } from "zod";
import { databaseConfigSchema, storageConfigSchema, aiConfigSchema } from "./setup-config";

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
  ...databaseConfigSchema.shape,
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),

  PAYPAL_ENV: z.literal("sandbox", {
    error: "PAYPAL_ENV must be 'sandbox' (production is forbidden)",
  }),
  PAYPAL_CLIENT_ID: z.string().min(1, "PAYPAL_CLIENT_ID is required"),
  PAYPAL_CLIENT_SECRET: z.string().min(1, "PAYPAL_CLIENT_SECRET is required"),
  PAYPAL_WEBHOOK_ID: z.string().min(1, "PAYPAL_WEBHOOK_ID is required"),
  PAYPAL_WEBHOOK_VERIFY: booleanString(true),

  ...aiConfigSchema.shape,

  ...storageConfigSchema.shape,

  AGENT_SWEEP_SECRET: z.string().min(1, "AGENT_SWEEP_SECRET is required"),
  DEMO_MODE: booleanString(false),
  DEMO_PAYPAL_RECIPIENTS: z.string().optional().default("").transform(s => s.split(",").map(v => v.trim()).filter(Boolean)).pipe(z.array(z.string().email())),
  DEMO_BUYER_EMAIL: z.union([z.string().email(), z.literal("")]).optional().default(""),
  DEMO_BUYER_PASSWORD: z.string().optional().default(""),
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
