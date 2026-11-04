import { generateGeminiText } from "./gemini";
import { env } from "@/server/env";
import { DISPUTE_SUMMARY_SYSTEM_PROMPT } from "@/server/agent/prompts";
import { getDisputeReasonLabel } from "@/server/audit";
import type { DisputeReason } from "./evaluate";
import type { Extraction } from "./vision/schema";

export interface DisputeFacts {
  reason: DisputeReason;
  playerA: {
    gamertag: string;
    submitted: boolean;
    extractionStatus?: string;
    extracted?: Extraction | null;
  };
  playerB: {
    gamertag: string;
    submitted: boolean;
    extractionStatus?: string;
    extracted?: Extraction | null;
  };
}

function describePlayerSubmission(
  player: DisputeFacts["playerA"]
): string {
  if (!player.submitted) {
    return "no screenshot";
  }
  if (
    player.extractionStatus === "unreadable" ||
    player.extractionStatus === "malformed" ||
    !player.extracted
  ) {
    return "an unreadable screenshot";
  }
  const ext = player.extracted;
  const homeStr = `${ext.home.name ?? "?"} ${ext.home.score ?? "?"}`;
  const awayStr = `${ext.away.name ?? "?"} ${ext.away.score ?? "?"}`;
  const confPct = `${Math.round(ext.confidence * 100)}%`;
  return `${homeStr} vs ${awayStr} (confidence ${confPct})`;
}

/**
 * Deterministic fallback template per `05 §Prompts`:
 * `"<reason label>: <player A> submitted <summary>; <player B> submitted <summary>."`
 * Guaranteed never to mention money, prizes, or dollar amounts.
 */
export function buildDisputeFallbackSummary(facts: DisputeFacts): string {
  const reasonLabel = getDisputeReasonLabel(facts.reason);
  const summaryA = describePlayerSubmission(facts.playerA);
  const summaryB = describePlayerSubmission(facts.playerB);
  return `${reasonLabel}: ${facts.playerA.gamertag} submitted ${summaryA}; ${facts.playerB.gamertag} submitted ${summaryB}.`;
}

const MONEY_PATTERN =
  /(\$\s*\d|\bdollars?\b|\bcents?\b|\busd\b|\bprize\b|\bpayout\b)/i;

export function sanitizeDisputeSummary(
  candidate: string,
  facts: DisputeFacts
): string {
  const trimmed = candidate.trim().replace(/\s+/g, " ");
  if (!trimmed || MONEY_PATTERN.test(trimmed)) {
    return buildDisputeFallbackSummary(facts);
  }
  const words = trimmed.split(" ");
  if (words.length > 75) {
    return `${words.slice(0, 70).join(" ")}...`;
  }
  return trimmed;
}

export type DisputeSummarizerFn = (facts: DisputeFacts) => Promise<string>;

let customSummarizer: DisputeSummarizerFn | null = null;

export function setDisputeSummarizer(fn: DisputeSummarizerFn | null): void {
  customSummarizer = fn;
}

export async function generateDisputeSummary(
  facts: DisputeFacts
): Promise<string> {
  if (customSummarizer) {
    try {
      const text = await customSummarizer(facts);
      return sanitizeDisputeSummary(text, facts);
    } catch {
      return buildDisputeFallbackSummary(facts);
    }
  }

  // In unit test environment with placeholder key, use deterministic template directly
  if (env.GEMINI_API_KEY.startsWith("test-")) {
    return buildDisputeFallbackSummary(facts);
  }

  try {
    const rawText = await generateGeminiText({
      system: DISPUTE_SUMMARY_SYSTEM_PROMPT,
      text: JSON.stringify(facts),
    });
    return sanitizeDisputeSummary(rawText, facts);
  } catch {
    return buildDisputeFallbackSummary(facts);
  }
}
