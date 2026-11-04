import { z } from "zod";
import { aiConfigSchema, parseSetupConfig } from "@/server/setup-config";
import { AppError } from "@/lib/errors";

const responseSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({ parts: z.array(z.object({
      text: z.string().optional(),
      thought: z.boolean().optional(),
    })) }).optional(),
  })).optional(),
});

/** Shared server-only REST transport for the three narrow model tasks. */
export async function generateGeminiText(input: {
  system: string;
  text: string;
  image?: { bytes: Uint8Array; mimeType: string };
  json?: boolean;
}, fetchImpl: typeof fetch = fetch): Promise<string> {
  const env = parseSetupConfig(aiConfigSchema);
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  if (input.image) {
    parts.push({ inlineData: {
      mimeType: input.image.mimeType,
      data: Buffer.from(input.image.bytes).toString("base64"),
    } });
  }
  parts.push({ text: input.text });
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.VISION_MODEL)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          maxOutputTokens: 4096,
          ...(input.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    }
  );
  // Never echo provider bodies: they may contain credentials or untrusted evidence.
  if (!response.ok) {
    throw new AppError("AI_PROVIDER_ERROR", `Gemini request failed (HTTP ${response.status}). Try again.`, 502);
  }
  const result = responseSchema.safeParse(await response.json());
  if (!result.success || result.data.promptFeedback?.blockReason) return "";
  const candidate = result.data.candidates?.[0];
  if (!candidate || candidate.finishReason !== "STOP") return "";
  return candidate.content?.parts.filter(part => !part.thought).map(part => part.text ?? "").join("\n") ?? "";
}
