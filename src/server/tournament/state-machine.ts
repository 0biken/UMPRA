import { AppError } from "@/lib/errors";
import type { MatchStatus, TournamentState } from "@/server/db/schema";

export const ALL_TOURNAMENT_STATES: readonly TournamentState[] = [
  "draft",
  "open",
  "locked",
  "in_progress",
  "results_pending",
  "confirmed",
  "paid",
  "cancelled",
  "refunded",
] as const;

export const ALL_MATCH_STATES: readonly MatchStatus[] = [
  "waiting",
  "awaiting_results",
  "disputed",
  "confirmed",
] as const;

const LEGAL_TOURNAMENT_TRANSITIONS: Readonly<
  Record<TournamentState, readonly TournamentState[]>
> = {
  draft: ["open", "cancelled"],
  open: ["locked", "cancelled"],
  locked: ["in_progress"],
  in_progress: ["results_pending"],
  results_pending: ["confirmed"],
  confirmed: ["paid"],
  paid: [],
  cancelled: ["refunded"],
  refunded: [],
};

const LEGAL_MATCH_TRANSITIONS: Readonly<
  Record<MatchStatus, readonly MatchStatus[]>
> = {
  waiting: ["awaiting_results"],
  awaiting_results: ["confirmed", "disputed"],
  disputed: ["confirmed"],
  confirmed: [],
};

export function canTransition(
  from: TournamentState,
  to: TournamentState
): boolean {
  const allowed = LEGAL_TOURNAMENT_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function assertTransition(
  from: TournamentState,
  to: TournamentState
): void {
  if (!canTransition(from, to)) {
    throw new AppError(
      "INVALID_TRANSITION",
      `Cannot transition tournament from '${from}' to '${to}'.`,
      409
    );
  }
}

export function canMatchTransition(
  from: MatchStatus,
  to: MatchStatus
): boolean {
  const allowed = LEGAL_MATCH_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function assertMatchTransition(
  from: MatchStatus,
  to: MatchStatus
): void {
  if (!canMatchTransition(from, to)) {
    throw new AppError(
      "INVALID_TRANSITION",
      `Cannot transition match from '${from}' to '${to}'.`,
      409
    );
  }
}
