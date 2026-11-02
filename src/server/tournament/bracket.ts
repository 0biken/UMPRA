import crypto from "crypto";
import { asc, eq } from "drizzle-orm";
import { AppError } from "@/lib/errors";
import {
  db,
  matches,
  tournaments,
  type DbOrTx,
  type MatchSlot,
  type MatchStatus,
} from "@/server/db";
import { assertMatchTransition } from "./state-machine";

export interface PlannedMatch {
  id: string;
  tournamentId: string;
  round: number;
  position: number;
  playerAId: string | null;
  playerBId: string | null;
  status: MatchStatus;
  winnerId: string | null;
  nextMatchId: string | null;
  nextSlot: MatchSlot | null;
  awaitingSince: Date | null;
}

/**
 * Deterministic 32-bit PRNG (Mulberry32) so the same seed always produces the exact same bracket.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic UUID v4-like identifier derived from (tournamentId, seed, round, position)
 */
function deterministicMatchId(
  tournamentId: string,
  seed: number,
  round: number,
  position: number
): string {
  const hash = crypto
    .createHash("sha256")
    .update(`umpra-match:${tournamentId}:${seed}:r${round}:p${position}`)
    .digest("hex");
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const copy = [...items];
  const rng = createSeededRng(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Pure deterministic function that builds the 7 matches of an 8-player single-elimination bracket.
 */
export function buildSingleElimBracket(
  tournamentId: string,
  playerIds: readonly string[],
  seed: number,
  now: Date = new Date()
): PlannedMatch[] {
  if (playerIds.length !== 8) {
    throw new AppError(
      "VALIDATION",
      `Single-elimination bracket requires exactly 8 players (received ${playerIds.length}).`,
      400
    );
  }
  const uniqueIds = new Set(playerIds);
  if (uniqueIds.size !== 8) {
    throw new AppError(
      "VALIDATION",
      "Bracket players must be 8 distinct player IDs.",
      400
    );
  }

  const shuffled = seededShuffle(playerIds, seed);

  const finalId = deterministicMatchId(tournamentId, seed, 3, 0);
  const semi0Id = deterministicMatchId(tournamentId, seed, 2, 0);
  const semi1Id = deterministicMatchId(tournamentId, seed, 2, 1);
  const qf0Id = deterministicMatchId(tournamentId, seed, 1, 0);
  const qf1Id = deterministicMatchId(tournamentId, seed, 1, 1);
  const qf2Id = deterministicMatchId(tournamentId, seed, 1, 2);
  const qf3Id = deterministicMatchId(tournamentId, seed, 1, 3);

  const planned: PlannedMatch[] = [
    // Round 1 (Quarterfinals)
    {
      id: qf0Id,
      tournamentId,
      round: 1,
      position: 0,
      playerAId: shuffled[0],
      playerBId: shuffled[1],
      status: "awaiting_results",
      winnerId: null,
      nextMatchId: semi0Id,
      nextSlot: "a",
      awaitingSince: now,
    },
    {
      id: qf1Id,
      tournamentId,
      round: 1,
      position: 1,
      playerAId: shuffled[2],
      playerBId: shuffled[3],
      status: "awaiting_results",
      winnerId: null,
      nextMatchId: semi0Id,
      nextSlot: "b",
      awaitingSince: now,
    },
    {
      id: qf2Id,
      tournamentId,
      round: 1,
      position: 2,
      playerAId: shuffled[4],
      playerBId: shuffled[5],
      status: "awaiting_results",
      winnerId: null,
      nextMatchId: semi1Id,
      nextSlot: "a",
      awaitingSince: now,
    },
    {
      id: qf3Id,
      tournamentId,
      round: 1,
      position: 3,
      playerAId: shuffled[6],
      playerBId: shuffled[7],
      status: "awaiting_results",
      winnerId: null,
      nextMatchId: semi1Id,
      nextSlot: "b",
      awaitingSince: now,
    },
    // Round 2 (Semifinals)
    {
      id: semi0Id,
      tournamentId,
      round: 2,
      position: 0,
      playerAId: null,
      playerBId: null,
      status: "waiting",
      winnerId: null,
      nextMatchId: finalId,
      nextSlot: "a",
      awaitingSince: null,
    },
    {
      id: semi1Id,
      tournamentId,
      round: 2,
      position: 1,
      playerAId: null,
      playerBId: null,
      status: "waiting",
      winnerId: null,
      nextMatchId: finalId,
      nextSlot: "b",
      awaitingSince: null,
    },
    // Round 3 (Final)
    {
      id: finalId,
      tournamentId,
      round: 3,
      position: 0,
      playerAId: null,
      playerBId: null,
      status: "waiting",
      winnerId: null,
      nextMatchId: null,
      nextSlot: null,
      awaitingSince: null,
    },
  ];

  return planned;
}

/**
 * Generates and persists the 7 bracket matches in the database (idempotent if already generated).
 * Inserts from Round 3 down to Round 1 so `next_match_id` foreign keys resolve immediately.
 */
export async function generateBracketForTournament(
  txOrDb: DbOrTx,
  tournamentId: string,
  playerIds: readonly string[],
  seed: number,
  now: Date = new Date()
): Promise<PlannedMatch[]> {
  const existing = await txOrDb
    .select()
    .from(matches)
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matches.round), asc(matches.position));

  if (existing.length === 7) {
    return existing.map((m) => ({
      id: m.id,
      tournamentId: m.tournamentId,
      round: m.round,
      position: m.position,
      playerAId: m.playerAId ?? null,
      playerBId: m.playerBId ?? null,
      status: m.status,
      winnerId: m.winnerId ?? null,
      nextMatchId: m.nextMatchId ?? null,
      nextSlot: m.nextSlot ?? null,
      awaitingSince: m.awaitingSince ?? null,
    }));
  }

  const planned = buildSingleElimBracket(tournamentId, playerIds, seed, now);
  // Sort Round 3 -> Round 2 -> Round 1 for foreign key integrity on next_match_id
  const insertOrder = [...planned].sort(
    (a, b) => b.round - a.round || a.position - b.position
  );

  for (const m of insertOrder) {
    await txOrDb.insert(matches).values({
      id: m.id,
      tournamentId: m.tournamentId,
      round: m.round,
      position: m.position,
      playerAId: m.playerAId,
      playerBId: m.playerBId,
      status: m.status,
      winnerId: m.winnerId,
      nextMatchId: m.nextMatchId,
      nextSlot: m.nextSlot,
      awaitingSince: m.awaitingSince,
    });
  }

  await txOrDb
    .update(tournaments)
    .set({ bracketSeed: seed })
    .where(eq(tournaments.id, tournamentId));

  return planned;
}

export interface AdvanceWinnerResult {
  advanced: boolean;
  nextMatchId: string | null;
  nextMatchActivated: boolean;
  nextRound: number | null;
}

/**
 * Places the confirmed winner of `matchId` into `next_match_id`'s `next_slot` ('a' or 'b')
 * and activates the next match (`waiting -> awaiting_results`) when both slots are filled.
 * Calling `advanceWinner` twice for the same match is a complete no-op (idempotent).
 */
export async function advanceWinner(
  matchId: string,
  txOrDb: DbOrTx = db,
  now: Date = new Date()
): Promise<AdvanceWinnerResult> {
  const [match] = await txOrDb
    .select()
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!match) {
    throw new AppError("NOT_FOUND", "Match not found.", 404);
  }
  if (!match.winnerId) {
    throw new AppError(
      "VALIDATION",
      "Cannot advance match without a confirmed winner.",
      400
    );
  }
  if (
    match.winnerId !== match.playerAId &&
    match.winnerId !== match.playerBId
  ) {
    throw new AppError(
      "VALIDATION",
      "Winner must be one of the two match participants.",
      400
    );
  }

  // Final match has no nextMatchId
  if (!match.nextMatchId || !match.nextSlot) {
    return {
      advanced: false,
      nextMatchId: null,
      nextMatchActivated: false,
      nextRound: null,
    };
  }

  const [nextMatch] = await txOrDb
    .select()
    .from(matches)
    .where(eq(matches.id, match.nextMatchId))
    .limit(1);

  if (!nextMatch) {
    throw new AppError("NOT_FOUND", "Linked next match not found.", 404);
  }

  const currentSlotOccupant =
    match.nextSlot === "a" ? nextMatch.playerAId : nextMatch.playerBId;

  // Idempotency: if winner is already placed in the target slot, do nothing
  if (currentSlotOccupant === match.winnerId) {
    return {
      advanced: false,
      nextMatchId: nextMatch.id,
      nextMatchActivated: false,
      nextRound: nextMatch.round,
    };
  }

  const newPlayerAId =
    match.nextSlot === "a" ? match.winnerId : nextMatch.playerAId;
  const newPlayerBId =
    match.nextSlot === "b" ? match.winnerId : nextMatch.playerBId;
  const bothFilled = Boolean(newPlayerAId && newPlayerBId);

  let newStatus: MatchStatus = nextMatch.status;
  let newAwaitingSince = nextMatch.awaitingSince;
  let nextMatchActivated = false;

  if (bothFilled && nextMatch.status === "waiting") {
    assertMatchTransition(nextMatch.status, "awaiting_results");
    newStatus = "awaiting_results";
    newAwaitingSince = now;
    nextMatchActivated = true;
  }

  await txOrDb
    .update(matches)
    .set({
      playerAId: newPlayerAId,
      playerBId: newPlayerBId,
      status: newStatus,
      awaitingSince: newAwaitingSince,
    })
    .where(eq(matches.id, nextMatch.id));

  return {
    advanced: true,
    nextMatchId: nextMatch.id,
    nextMatchActivated,
    nextRound: nextMatch.round,
  };
}

export function getRoundName(round: number): string {
  if (round === 1) return "Quarterfinals";
  if (round === 2) return "Semifinals";
  if (round === 3) return "the Final";
  return `Round ${round}`;
}
