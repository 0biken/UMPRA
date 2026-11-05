import { generateGeminiText } from "./gemini";
import { z } from "zod";
import { env } from "@/server/env";
import { TOURNAMENT_PARSE_SYSTEM_PROMPT } from "./prompts";
import { stripCodeFences } from "./vision/schema";
import {
  validateTournamentConfig,
  type ValidatedTournamentConfig,
} from "@/server/tournament/config";
import type { PayoutSplitBps } from "@/server/db/schema";

export const RawParsedTournamentSchema = z.object({
  title: z.string().nullable().optional(),
  game: z.string().nullable().optional(),
  slots: z.number().nullable().optional(),
  entry_fee_usd: z.number().nullable().optional(),
  payout_split: z
    .array(
      z.object({
        place: z.number().int(),
        percent: z.number(),
      })
    )
    .nullable()
    .optional(),
  problems: z.array(z.string()).optional().default([]),
});

export type RawParsedTournament = z.infer<typeof RawParsedTournamentSchema>;

export interface ParsedTournamentPreview {
  valid: boolean;
  problems: string[];
  raw: RawParsedTournament;
  preview: {
    title: string;
    game: string;
    format: "single_elimination";
    slots: number;
    entryFeeUsd: number | null;
    entryFeeCents: number | null;
    winnerPercent: number | null;
    runnerUpPercent: number | null;
    payoutSplit: PayoutSplitBps | null;
  };
  validatedConfig: ValidatedTournamentConfig | null;
}

/**
 * Deterministic rule-based parser for plain-language tournament descriptions.
 * Used as fallback when Gemini API is not configured or returns malformed output,
 * and ensures fast, deterministic unit/integration testing.
 */
export function parseTournamentDescriptionRuleBased(
  description: string
): RawParsedTournament {
  const text = description.trim();
  const problems: string[] = [];

  // 1. Check for unsupported formats or currencies explicitly mentioned
  if (/\b(double[-\s]?elim(?:ination)?|round[-\s]?robin|swiss|group\s+stage)\b/i.test(text)) {
    problems.push(
      "We only support 8-player single-elimination knockout tournaments right now."
    );
  }
  if (/\b(ngn|naira|eur|gbp|cad|jpy)\b|[€£¥₦]/i.test(text)) {
    problems.push("Only USD entry fees and payouts are supported in sandbox mode.");
  }

  // 2. Extract slots (e.g., "8-player", "16 players", "8 man", "8 slots")
  let slots: number | null = null;
  const slotsMatch = text.match(
    /\b(\d+)\s*[-\s]?(?:player|players|man|person|slots|teams|entrants)\b/i
  );
  if (slotsMatch) {
    slots = Number(slotsMatch[1]);
  } else if (/\bknockout\b|\bbracket\b|\btournament\b/i.test(text)) {
    slots = 8;
  }

  // 3. Extract entry fee in USD (e.g., "$5", "$5.00", "5 usd", "entry $10", "$200 fee")
  let entryFeeUsd: number | null = null;
  const dollarMatch =
    text.match(/\$\s*(\d+(?:\.\d{1,2})?)/) ??
    text.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:usd|dollars?)\b/i) ??
    text.match(/\bentry(?:\s+fee)?(?:\s+of)?\s*\$?\s*(\d+(?:\.\d{1,2})?)\b/i);
  if (dollarMatch) {
    entryFeeUsd = Number(dollarMatch[1]);
  }

  // 4. Extract payout split
  let payoutSplit: Array<{ place: number; percent: number }> | null = null;

  // Check for "winner takes all" or "100% to winner"
  if (/\bwinner\s+takes?\s+all\b|\b100\s*%\s*(?:to\s+)?(?:winner|1st|first)\b/i.test(text)) {
    payoutSplit = [{ place: 1, percent: 100 }];
  } else {
    // Check for slash split like "70/30" or "70/20/10" or "80-20 split"
    const slashSplitMatch = text.match(
      /\b(\d{1,3})\s*[/\-]\s*(\d{1,3})(?:\s*[/\-]\s*(\d{1,3}))?\s*(?:split|%)?/i
    );
    // Avoid matching dates like 11/01 unless followed by split/% or summing to ~100
    if (
      slashSplitMatch &&
      (Number(slashSplitMatch[1]) + Number(slashSplitMatch[2]) >= 50 ||
        /split|%/i.test(slashSplitMatch[0]))
    ) {
      payoutSplit = [
        { place: 1, percent: Number(slashSplitMatch[1]) },
        { place: 2, percent: Number(slashSplitMatch[2]) },
      ];
      if (slashSplitMatch[3]) {
        payoutSplit.push({ place: 3, percent: Number(slashSplitMatch[3]) });
      }
    } else {
      // Match explicit percentages in order (e.g. "winner 70%, runner-up 30%", "1st 60% 2nd 40%")
      const pctMatches = Array.from(text.matchAll(/(\d+(?:\.\d+)?)\s*%/g));
      if (pctMatches.length > 0) {
        payoutSplit = pctMatches.map((m, idx) => ({
          place: idx + 1,
          percent: Number(m[1]),
        }));
      }
    }
  }

  // 5. Extract title and game if stated
  let title: string | null = null;
  const quotedTitle = text.match(/["“]([^"”]{3,60})["”]/);
  if (quotedTitle) {
    title = quotedTitle[1].trim();
  } else if (/friday/i.test(text)) {
    title = "Friday Night Knockout";
  } else if (/saturday/i.test(text)) {
    title = "Saturday Showdown";
  } else if (/sunday/i.test(text)) {
    title = "Sunday Cup";
  } else {
    title = "Weekend Knockout Cup";
  }

  let game: string | null = "Spot Kick Club";
  const gameMatch = text.match(/\b(?:game|playing)\s*:\s*([A-Za-z0-9\s\-]{2,40})/i);
  if (gameMatch) {
    game = gameMatch[1].trim();
  }

  return {
    title,
    game,
    slots,
    entry_fee_usd: entryFeeUsd,
    payout_split: payoutSplit,
    problems,
  };
}

/**
 * Validates a `RawParsedTournament` against Umpra's strict tournament configuration rules.
 * Never silently alters unsupported requests (`05 §Prompts`, `T-071`, `EC-S2`):
 * any out-of-range fee, non-8 slot count, >2 paid places, or non-100% split is reported in `problems`.
 */
export function evaluateParsedTournament(
  raw: RawParsedTournament
): ParsedTournamentPreview {
  const problems = [...(raw.problems ?? [])];

  const addProblem = (msg: string) => {
    if (!problems.some((p) => p.toLowerCase() === msg.toLowerCase())) {
      problems.push(msg);
    }
  };

  // Validate slots
  const requestedSlots = raw.slots ?? 8;
  if (raw.slots === null || raw.slots === undefined) {
    addProblem("Player count was not stated; Umpra runs 8-player tournaments.");
  } else if (raw.slots !== 8) {
    addProblem(
      `We only support 8-player single elimination right now (you asked for ${raw.slots} players).`
    );
  }

  // Validate entry fee
  const entryFeeUsd = raw.entry_fee_usd ?? null;
  let entryFeeCents: number | null = null;
  if (entryFeeUsd === null || Number.isNaN(entryFeeUsd)) {
    addProblem("Entry fee was not specified. Enter an amount between $1 and $20.");
  } else {
    entryFeeCents = Math.round(entryFeeUsd * 100);
    if (entryFeeUsd < 1 || entryFeeUsd > 20) {
      addProblem(
        `Entry fee must be between $1.00 and $20.00 (you asked for $${entryFeeUsd}).`
      );
    }
  }

  // Validate payout split
  let winnerPercent: number | null = null;
  let runnerUpPercent: number | null = null;
  let payoutSplit: PayoutSplitBps | null = null;

  if (!raw.payout_split || raw.payout_split.length === 0) {
    addProblem(
      "Payout split was not specified (for example: winner 70%, runner-up 30%)."
    );
  } else {
    if (raw.payout_split.length > 2) {
      addProblem(
        `Umpra supports at most 2 paid places (winner and runner-up); you specified ${raw.payout_split.length} places.`
      );
    }
    const invalidPlace = raw.payout_split.find(
      (item) => item.place !== 1 && item.place !== 2
    );
    if (invalidPlace && raw.payout_split.length <= 2) {
      addProblem(
        `Paid places must be 1st and optionally 2nd place (found place ${invalidPlace.place}).`
      );
    }

    const totalPct = raw.payout_split.reduce((acc, item) => acc + item.percent, 0);
    if (Math.round(totalPct * 100) !== 10000) {
      addProblem(
        `Payout percentages must total 100% (currently ${totalPct}%).`
      );
    }

    const p1 = raw.payout_split.find((i) => i.place === 1)?.percent ?? null;
    const p2 = raw.payout_split.find((i) => i.place === 2)?.percent ?? 0;
    winnerPercent = p1;
    runnerUpPercent = p2;

    if (
      p1 !== null &&
      p1 > 0 &&
      raw.payout_split.length <= 2 &&
      !invalidPlace &&
      Math.round(totalPct * 100) === 10000
    ) {
      payoutSplit = { "1": Math.round(p1 * 100) };
      if (p2 > 0) {
        payoutSplit["2"] = Math.round(p2 * 100);
      }
    }
  }

  const title =
    raw.title && raw.title.trim().length >= 3
      ? raw.title.trim()
      : "Weekend Knockout Cup";
  const game =
    raw.game && raw.game.trim().length >= 2
      ? raw.game.trim()
      : "Spot Kick Club";

  let validatedConfig: ValidatedTournamentConfig | null = null;
  if (
    problems.length === 0 &&
    requestedSlots === 8 &&
    entryFeeCents !== null &&
    payoutSplit !== null
  ) {
    try {
      validatedConfig = validateTournamentConfig({
        title,
        game,
        format: "single_elimination",
        slots: 8,
        entryFeeCents,
        currency: "USD",
        payoutSplit,
      });
    } catch (err) {
      addProblem(
        err instanceof Error ? err.message : "Invalid tournament configuration."
      );
    }
  }

  return {
    valid: problems.length === 0 && validatedConfig !== null,
    problems,
    raw,
    preview: {
      title,
      game,
      format: "single_elimination",
      slots: requestedSlots,
      entryFeeUsd,
      entryFeeCents,
      winnerPercent,
      runnerUpPercent,
      payoutSplit,
    },
    validatedConfig,
  };
}

/**
 * Parses a host's plain-language tournament prompt into a validated config preview
 * or field-level problems (`T-071`, `05 §Prompts`). Nothing is persisted.
 */
export async function parseTournamentPrompt(
  promptText: string,
  options?: {
    llmCall?: (prompt: string) => Promise<string>;
  }
): Promise<ParsedTournamentPreview> {
  const trimmed = promptText.trim();
  if (!trimmed) {
    return evaluateParsedTournament({
      title: null,
      game: null,
      slots: 8,
      entry_fee_usd: null,
      payout_split: null,
      problems: ["Describe your tournament (for example: '8-player knockout, $5 entry, winner 70%, runner-up 30%')."],
    });
  }

  const ruleBased = parseTournamentDescriptionRuleBased(trimmed);

  const callFn =
    options?.llmCall ??
    (env.GEMINI_API_KEY &&
    !env.GEMINI_API_KEY.includes("placeholder") &&
    !env.GEMINI_API_KEY.startsWith("test-") &&
    process.env.NODE_ENV !== "test"
      ? async (input: string) => {
          return generateGeminiText({
            system: TOURNAMENT_PARSE_SYSTEM_PROMPT,
            text: input,
            json: true,
          });
        }
      : undefined);

  if (callFn) {
    try {
      const rawOutput = await callFn(trimmed);
      const cleaned = stripCodeFences(rawOutput);
      const parsedJson = JSON.parse(cleaned);
      const validatedRaw = RawParsedTournamentSchema.safeParse(parsedJson);
      if (validatedRaw.success) {
        const mergedRaw: RawParsedTournament = {
          title: validatedRaw.data.title ?? ruleBased.title,
          game: validatedRaw.data.game ?? ruleBased.game,
          slots: ruleBased.slots ?? validatedRaw.data.slots,
          entry_fee_usd:
            ruleBased.entry_fee_usd ?? validatedRaw.data.entry_fee_usd,
          payout_split:
            ruleBased.payout_split ?? validatedRaw.data.payout_split,
          problems: [
            ...validatedRaw.data.problems,
            ...(ruleBased.problems ?? []),
          ],
        };
        return evaluateParsedTournament(mergedRaw);
      }
    } catch {
      // Fall back to deterministic rule-based extraction
    }
  }

  return evaluateParsedTournament(ruleBased);
}
