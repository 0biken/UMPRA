export const DISPUTE_REASON_LABELS: Record<string, string> = {
  no_submissions: "No results submitted",
  missing_opponent_submission: "Only one player submitted",
  unreadable_evidence: "Screenshot could not be read",
  low_confidence: "Screenshot unclear",
  player_mismatch: "Names on screenshot don't match",
  no_decisive_result: "No clear winner",
  conflicting_results: "Screenshots disagree",
};

export function getDisputeReasonLabel(reason: string): string {
  return DISPUTE_REASON_LABELS[reason] ?? reason;
}

