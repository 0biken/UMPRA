import { z } from "zod";

export const ExtractionSchema = z.object({
  readable: z.boolean(),
  game_over: z.boolean(),
  home: z.object({
    name: z.string().nullable(),
    score: z.number().int().min(0).max(99).nullable(),
  }),
  away: z.object({
    name: z.string().nullable(),
    score: z.number().int().min(0).max(99).nullable(),
  }),
  confidence: z.number().min(0).max(1),
  notes: z.string().max(200),
});

export type { Extraction } from "@/lib/vision-types";
import type { Extraction } from "@/lib/vision-types";

export type ParseExtractionOutcome =
  | { status: "ok"; data: Extraction }
  | { status: "malformed"; error: string };

/**
 * Strips optional markdown code fences or surrounding prose, parses JSON,
 * and validates against `ExtractionSchema`. Never throws on bad model output.
 */
export function parseVisionExtractionOutput(
  rawOutput: string
): ParseExtractionOutcome {
  if (typeof rawOutput !== "string" || rawOutput.trim().length === 0) {
    return { status: "malformed", error: "Empty response from vision model." };
  }

  let candidate = rawOutput.trim();

  // Strip ```json ... ``` fences if present
  const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    candidate = fenceMatch[1].trim();
  } else {
    // Extract first {...} block if surrounded by prose
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
    }
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(candidate);
  } catch (err) {
    return {
      status: "malformed",
      error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const validated = ExtractionSchema.safeParse(parsedJson);
  if (!validated.success) {
    return {
      status: "malformed",
      error: validated.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }

  return { status: "ok", data: validated.data };
}

export function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence?.[1]?.trim() ?? trimmed;
}
