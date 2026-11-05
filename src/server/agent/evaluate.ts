import type { ExtractionStatus } from "@/server/db/schema";
import type { Extraction } from "./vision/schema";

export type DisputeReason =
  | "no_submissions"
  | "missing_opponent_submission"
  | "unreadable_evidence"
  | "low_confidence"
  | "player_mismatch"
  | "no_decisive_result"
  | "conflicting_results";

export type EvaluationDecision =
  | { outcome: "wait" }
  | { outcome: "dispute"; reason: DisputeReason }
  | {
      outcome: "confirm";
      winnerId: string;
      loserId: string;
      scoreA: number;
      scoreB: number;
      formattedScore: string;
    };

export interface EvaluableMatch {
  id: string;
  playerAId: string;
  playerBId: string;
  awaitingSince: Date | null;
}

export interface EvaluablePlayer {
  id: string;
  gamertag: string;
}

export interface EvaluableSubmission {
  id: string;
  playerId: string;
  extractionStatus: ExtractionStatus;
  extractedJson: Extraction | null;
  confidence: number | null;
  createdAt: Date;
}

export interface EvaluationTimeouts {
  matchTimeoutMin: number;
  secondSubmissionTimeoutMin: number;
}

function normalizeGamertag(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

function mapScoresToPlayers(
  extraction: Extraction,
  gamertagA: string,
  gamertagB: string
):
  | { matched: false }
  | { matched: true; scoreA: number | null; scoreB: number | null } {
  const homeName = extraction.home?.name;
  const awayName = extraction.away?.name;
  if (!homeName || !awayName) {
    return { matched: false };
  }

  const normHome = normalizeGamertag(homeName);
  const normAway = normalizeGamertag(awayName);
  const normA = normalizeGamertag(gamertagA);
  const normB = normalizeGamertag(gamertagB);

  if (normHome === normA && normAway === normB) {
    return {
      matched: true,
      scoreA: extraction.home.score,
      scoreB: extraction.away.score,
    };
  }

  if (normHome === normB && normAway === normA) {
    return {
      matched: true,
      scoreA: extraction.away.score,
      scoreB: extraction.home.score,
    };
  }

  return { matched: false };
}

/**
 * Pure agreement rule function (`05 §Agreement rule`).
 * Evaluates submissions for a match in strict row-priority order (rows 1 to 9).
 */
export function evaluateSubmissions(
  match: EvaluableMatch,
  submissions: readonly EvaluableSubmission[],
  players: { playerA: EvaluablePlayer; playerB: EvaluablePlayer },
  now: Date = new Date(),
  timeouts: EvaluationTimeouts = {
    matchTimeoutMin: 30,
    secondSubmissionTimeoutMin: 15,
  }
): EvaluationDecision {
  // Row 1: No submissions
  if (submissions.length === 0) {
    if (match.awaitingSince) {
      const elapsedMs = now.getTime() - match.awaitingSince.getTime();
      if (elapsedMs > timeouts.matchTimeoutMin * 60 * 1000) {
        return { outcome: "dispute", reason: "no_submissions" };
      }
    }
    return { outcome: "wait" };
  }

  // Row 2: One submission
  if (submissions.length === 1) {
    const firstSub = submissions[0];
    const elapsedMs = now.getTime() - firstSub.createdAt.getTime();
    if (elapsedMs > timeouts.secondSubmissionTimeoutMin * 60 * 1000) {
      return { outcome: "dispute", reason: "missing_opponent_submission" };
    }
    return { outcome: "wait" };
  }

  // Row 3: Two submissions, any extraction `pending`
  if (submissions.some((s) => s.extractionStatus === "pending")) {
    return { outcome: "wait" };
  }

  // Row 4: Any extraction `unreadable` or `malformed` after retries
  if (
    submissions.some(
      (s) =>
        s.extractionStatus === "unreadable" ||
        s.extractionStatus === "malformed" ||
        !s.extractedJson
    )
  ) {
    return { outcome: "dispute", reason: "unreadable_evidence" };
  }

  const ext0 = submissions[0].extractedJson!;
  const ext1 = submissions[1].extractedJson!;

  // Row 5: Any `readable = false`, `game_over = false`, or `confidence < 0.8`
  for (const ext of [ext0, ext1]) {
    if (!ext.readable || !ext.game_over || ext.confidence < 0.8) {
      return { outcome: "dispute", reason: "low_confidence" };
    }
  }

  // Row 6: Names on a screenshot do not match the two registered gamertags (case and whitespace insensitive)
  const mapped0 = mapScoresToPlayers(
    ext0,
    players.playerA.gamertag,
    players.playerB.gamertag
  );
  const mapped1 = mapScoresToPlayers(
    ext1,
    players.playerA.gamertag,
    players.playerB.gamertag
  );

  if (!mapped0.matched || !mapped1.matched) {
    return { outcome: "dispute", reason: "player_mismatch" };
  }

  // Row 7: A score is null, or the score is a draw
  if (
    mapped0.scoreA === null ||
    mapped0.scoreB === null ||
    mapped1.scoreA === null ||
    mapped1.scoreB === null ||
    mapped0.scoreA === mapped0.scoreB ||
    mapped1.scoreA === mapped1.scoreB
  ) {
    return { outcome: "dispute", reason: "no_decisive_result" };
  }

  // Row 8: The two screenshots imply different winners or different score lines
  if (
    mapped0.scoreA !== mapped1.scoreA ||
    mapped0.scoreB !== mapped1.scoreB
  ) {
    return { outcome: "dispute", reason: "conflicting_results" };
  }

  // Row 9: Otherwise -> confirm(winner)
  const scoreA = mapped0.scoreA;
  const scoreB = mapped0.scoreB;
  const aWon = scoreA > scoreB;
  const winnerId = aWon ? players.playerA.id : players.playerB.id;
  const loserId = aWon ? players.playerB.id : players.playerA.id;
  const high = Math.max(scoreA, scoreB);
  const low = Math.min(scoreA, scoreB);

  return {
    outcome: "confirm",
    winnerId,
    loserId,
    scoreA,
    scoreB,
    formattedScore: `${high}-${low}`,
  };
}
