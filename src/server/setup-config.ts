import { z } from "zod";

export const databaseConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});
export const storageConfigSchema = z.object({
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  SUPABASE_BUCKET: z.string().min(1, "SUPABASE_BUCKET is required"),
});
export const aiConfigSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  VISION_MODEL: z.string().optional().transform(value => value?.trim() || "gemini-flash-latest"),
});
export function parseSetupConfig<T extends z.ZodType>(schema: T, raw: Record<string, string | undefined> = process.env): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Missing or invalid configuration: ${result.error.issues.map(i => i.path.join(".")).join(", ")}`);
  }
  return result.data;
}

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;
export const ALLOWED_SCREENSHOT_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Only codes, never driver messages, URLs, passwords, or response bodies. */
export function safeSetupError(error: unknown): string {
  const parsed = z.object({ code: z.string().regex(/^[A-Z0-9_]+$/).optional() }).safeParse(error);
  return parsed.success && parsed.data.code ? parsed.data.code : "SETUP_CHECK_FAILED";
}
