/** Serializable read models shared by route handlers and UI. */
export type TournamentState = "draft" | "open" | "locked" | "in_progress" | "results_pending" | "confirmed" | "paid" | "cancelled" | "refunded";
export type PayoutSplitBps = Record<string, number>;
export interface TournamentSummaryItem {
  id: string; hostId: string; title: string; game: string; format: string;
  slots: number; entryFeeCents: number; currency: string; payoutSplit: PayoutSplitBps;
  state: TournamentState; paidCount: number; pendingCount: number;
  prizePoolCents: number; maxPrizePoolCents: number; createdAt: string;
}
export interface SubmissionView {
  id: string; playerId: string; gamertag: string; extractionStatus: string;
  confidence: number | null; extractedJson: unknown; attempts: number; createdAt: string;
}
export interface DisputeView {
  id: string; reason: string; summary: string | null; status: "open" | "resolved";
  resolvedWinnerId: string | null; resolvedWinnerGamertag: string | null;
  resolutionNote: string | null;
}
export interface MatchView {
  id: string; round: number; position: number;
  playerAId: string | null; playerAGamertag: string | null; playerASimulated: boolean;
  playerBId: string | null; playerBGamertag: string | null; playerBSimulated: boolean;
  scoreA: number | null; scoreB: number | null; winnerId: string | null; winnerGamertag: string | null;
  status: "waiting" | "awaiting_results" | "confirmed" | "disputed";
  nextMatchId: string | null; nextSlot: "a" | "b" | null; awaitingSince: string | null;
  submissions: SubmissionView[]; dispute: DisputeView | null;
}
export interface LedgerRow {
  id: string; direction: "in" | "refund" | "out"; gamertag: string; description: string;
  amountCents: number; status: string; paypalId: string | null; createdAt: string;
}
export interface LedgerView {
  entriesIn: LedgerRow[]; refundsOut: LedgerRow[]; payoutsOut: LedgerRow[];
  totalCapturedCents: number; totalRefundedCents: number; netPoolCents: number;
  totalPaidOutCents: number; netBalanceCents: number;
}
export interface ActivityView {
  id: number; tournamentId: string | null; actorType: "agent" | "user" | "system" | "paypal";
  actorId: string | null; action: string; sentence: string; createdAt: string;
}
export interface TournamentDetailsResponse {
  tournament: {
    id: string; hostId: string; hostDisplayName: string; title: string; game: string;
    slots: number; entryFeeCents: number; currency: string; payoutSplit: PayoutSplitBps;
    state: TournamentState; championId: string | null; championGamertag: string | null;
    runnerUpId: string | null; runnerUpGamertag: string | null; cancelReason: string | null;
  };
  prizePoolCents: number; maxPrizePoolCents: number; paidCount: number; pendingCount: number;
  entries: Array<{ id: string; playerId: string; gamertag: string; status: string; simulated: boolean; createdAt: string; paypalEmail?: string | null }>;
  matches: MatchView[]; ledger: LedgerView; activity: ActivityView[];
}

export type UserRole = "host" | "player";
