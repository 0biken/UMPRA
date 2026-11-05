import { z } from "zod";
import { AppError } from "@/lib/errors";
import { dollarsToCents } from "@/lib/money";
import type { PayoutSplitBps } from "@/server/db/schema";

export interface ValidatedTournamentConfig {
  title: string;
  game: string;
  format: "single_elimination";
  slots: 8;
  entryFeeCents: number;
  currency: "USD";
  payoutSplit: PayoutSplitBps;
  registrationClosesAt?: Date | null;
}

const payoutSplitBpsSchema = z
  .record(z.string(), z.number().int().positive())
  .superRefine((split, ctx) => {
    const keys = Object.keys(split);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specify at least a 1st place payout.",
      });
      return;
    }
    if (keys.length > 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Umpra supports at most 2 paid places (winner and runner-up).",
      });
      return;
    }
    for (const key of keys) {
      if (key !== "1" && key !== "2") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Paid places must be '1' (winner) and optionally '2' (runner-up).",
        });
        return;
      }
    }
    if (keys.length === 2 && (!("1" in split) || !("2" in split))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Two-place splits must include both '1' and '2'.",
      });
      return;
    }
    const sum = Object.values(split).reduce((acc, v) => acc + v, 0);
    if (sum !== 10000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Payout split must total 100% (10000 bps); currently totals ${(sum / 100).toFixed(0)}%.`,
      });
    }
  });

export const tournamentConfigSchema = z
  .object({
    title: z
      .string({ error: "Enter a tournament title." })
      .trim()
      .min(3, "Title must be at least 3 characters.")
      .max(80, "Title must be at most 80 characters."),
    game: z
      .string({ error: "Enter the game name." })
      .trim()
      .min(2, "Game name must be at least 2 characters.")
      .max(60, "Game name must be at most 60 characters."),
    format: z
      .literal("single_elimination", {
        error: "Only single elimination format is supported.",
      })
      .default("single_elimination"),
    slots: z
      .literal(8, {
        error: "Only 8-player tournaments are supported.",
      })
      .default(8),
    entryFeeCents: z
      .number({
        error: "Enter an entry fee between $1 and $20.",
      })
      .int("Entry fee in cents must be a whole number.")
      .min(100, "Entry fee must be at least $1.00.")
      .max(2000, "Entry fee cannot exceed $20.00."),
    currency: z
      .literal("USD", {
        error: "Only USD is supported in sandbox mode.",
      })
      .default("USD"),
    payoutSplit: payoutSplitBpsSchema,
    registrationClosesAt: z
      .union([z.string().datetime(), z.date(), z.null()])
      .optional()
      .transform((val) => {
        if (!val) return null;
        return val instanceof Date ? val : new Date(val);
      }),
  });

export function validateTournamentConfig(
  rawInput: unknown
): ValidatedTournamentConfig {
  // Normalize optional convenience fields (e.g. entryFeeUsd or percentage split) if provided by form/parser
  const normalized: Record<string, unknown> =
    rawInput && typeof rawInput === "object"
      ? { ...(rawInput as Record<string, unknown>) }
      : {};

  if (
    normalized.entryFeeCents === undefined &&
    typeof normalized.entryFeeUsd === "number"
  ) {
    try {
      normalized.entryFeeCents = dollarsToCents(normalized.entryFeeUsd);
    } catch {
      normalized.entryFeeCents = -1;
    }
  }

  if (
    normalized.payoutSplit === undefined &&
    typeof normalized.winnerPercent === "number"
  ) {
    const winPct = normalized.winnerPercent;
    const runnerPct =
      typeof normalized.runnerUpPercent === "number"
        ? normalized.runnerUpPercent
        : 0;
    const split: PayoutSplitBps = {};
    if (winPct > 0) split["1"] = Math.round(winPct * 100);
    if (runnerPct > 0) split["2"] = Math.round(runnerPct * 100);
    normalized.payoutSplit = split;
  }

  const parsed = tournamentConfigSchema.safeParse(normalized);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const firstIssue =
      parsed.error.issues[0]?.message ?? "Invalid tournament configuration.";
    throw new AppError("VALIDATION", firstIssue, 400, { fieldErrors });
  }

  return parsed.data;
}
