import { desc, eq } from "drizzle-orm";
import { formatUsd } from "@/lib/money";
import {
  auditLog,
  db,
  type AuditActorType,
  type DbOrTx,
} from "@/server/db";

export interface AuditInput {
  tournamentId?: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
}

import { getDisputeReasonLabel } from "@/lib/dispute-reasons";
export { getDisputeReasonLabel } from "@/lib/dispute-reasons";

/**
 * Formats an audit log row into the official UI sentence specified in 05 §Audit log.
 */
export function formatAuditSentence(
  action: string,
  payload: Record<string, unknown> = {}
): string {
  const str = (key: string, fallback = "Someone") =>
    typeof payload[key] === "string" && (payload[key] as string).length > 0
      ? (payload[key] as string)
      : fallback;

  const moneyFromCents = (key: string, fallbackKey?: string) => {
    if (typeof payload[key] === "number") {
      return formatUsd(payload[key] as number);
    }
    if (fallbackKey && typeof payload[fallbackKey] === "string") {
      return `$${payload[fallbackKey]}`;
    }
    return "$0.00";
  };

  switch (action) {
    case "tournament.created":
      return `Created tournament "${str("title", "Tournament")}" (draft).`;
    case "tournament.opened":
      return "Registration is open.";
    case "tournament.cancelled":
    case "tournament.auto_cancelled":
      return payload.reason
        ? `Tournament cancelled: ${String(payload.reason)}.`
        : "Tournament cancelled.";
    case "tournament.refunded":
      return "All entry fees have been refunded.";
    case "entry.simulated":
      return `${str("gamertag", "Player")} joined as a simulated demo player; no funds collected.`;
    case "entry.paid": {
      const feeStr =
        typeof payload.amountCents === "number"
          ? formatUsd(payload.amountCents as number, { trimZeroCents: true })
          : `$${str("fee", "5")}`;
      return `${str("gamertag", "Player")} paid ${feeStr} and joined.`;
    }
    case "entry.expired":
      return `${str("gamertag", "Player")}'s checkout expired and the slot reopened.`;
    case "tournament.locked":
      return "All 8 slots are filled. Registration is closed.";
    case "bracket.generated":
      return "Umpra drew the bracket.";
    case "match.opened":
      return `${str("playerA", "Player A")} vs ${str("playerB", "Player B")} is ready to play.`;
    case "submission.received":
      return `${str("gamertag", "Player")} submitted a result screenshot.`;
    case "evidence.extracted": {
      const pct =
        typeof payload.confidence === "number"
          ? `${Math.round((payload.confidence as number) * 100)}%`
          : str("confidencePct", "0%");
      return `Read ${str("gamertag", "Player")}'s screenshot: ${str("score", "unreadable")} (confidence ${pct}).`;
    }
    case "match.confirmed":
      return `Both screenshots agree. ${str("winner", "Winner")} won ${str("score", "")}.`.replace(
        /\s+\.$/,
        "."
      );
    case "bracket.advanced":
      return `${str("winner", "Winner")} moves to ${str("roundName", "the next round")}.`;
    case "dispute.opened": {
      const reasonLabel = getDisputeReasonLabel(str("reason", "disputed"));
      return `Flagged ${str("playerA", "Player A")} vs ${str("playerB", "Player B")}: ${reasonLabel}. Host review needed.`;
    }
    case "dispute.resolved":
      return `${str("host", "Host")} ruled for ${str("winner", "winner")}.`;
    case "payout.drafted": {
      if (Array.isArray(payload.items) && payload.items.length > 0) {
        const summary = (
          payload.items as Array<{
            place: number;
            gamertag: string;
            amountCents: number;
          }>
        )
          .map(
            (item) =>
              `${item.place === 1 ? "1st" : "2nd"} ${item.gamertag} ${formatUsd(item.amountCents)}`
          )
          .join(", ");
        return `Payout drafted: ${summary}. Waiting for host to confirm.`;
      }
      return `Payout drafted: ${str("place", "1st")} ${str("gamertag", "Winner")} ${moneyFromCents("amountCents", "amount")}. Waiting for host to confirm.`;
    }
    case "payout.approved":
      return `${str("host", "Host")} confirmed the payout.`;
    case "payout.submitted":
      return "Sent to PayPal.";
    case "payout.item_succeeded":
      return `${str("gamertag", "Winner")} was paid ${moneyFromCents("amountCents", "amount")}.`;
    case "payout.item_failed":
      return `${str("gamertag", "Winner")}'s payout failed: ${str("error", "PayPal error")}.`;
    case "refund.issued":
      return `Refunded ${moneyFromCents("amountCents", "amount")} to ${str("gamertag", "player")}.`;
    default:
      return str("message", action);
  }
}

/**
 * Writes an audit log entry. When dedupeKey is provided, duplicate (tournament_id, dedupe_key)
 * inserts are ignored idempotently via the partial unique index `audit_dedupe`.
 */
export async function audit(
  txOrDb: DbOrTx,
  input: AuditInput
): Promise<{ inserted: boolean; id?: number }> {
  const rows = await txOrDb
    .insert(auditLog)
    .values({
      tournamentId: input.tournamentId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      payload: input.payload ?? {},
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: auditLog.id });

  if (rows.length === 0) {
    return { inserted: false };
  }
  return { inserted: true, id: rows[0].id };
}

export interface ActivityFeedItem {
  id: number;
  tournamentId: string | null;
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  payload: Record<string, unknown>;
  sentence: string;
  createdAt: Date;
}

export async function listTournamentActivity(
  tournamentId: string,
  txOrDb: DbOrTx = db
): Promise<ActivityFeedItem[]> {
  const rows = await txOrDb
    .select()
    .from(auditLog)
    .where(eq(auditLog.tournamentId, tournamentId))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id));

  return rows.map((row) => ({
    id: row.id,
    tournamentId: row.tournamentId,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    payload: row.payload ?? {},
    sentence: formatAuditSentence(row.action, row.payload ?? {}),
    createdAt: row.createdAt,
  }));
}
