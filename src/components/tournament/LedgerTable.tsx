import * as React from "react";
import { formatUsd } from "@/lib/money";

export interface LedgerEntryRow {
  id: string;
  direction: "in" | "refund" | "out";
  gamertag: string;
  description: string;
  amountCents: number;
  status: string;
  paypalId: string | null;
  createdAt: string | Date;
}

export interface LedgerData {
  entriesIn: LedgerEntryRow[];
  refundsOut: LedgerEntryRow[];
  payoutsOut: LedgerEntryRow[];
  totalCapturedCents: number;
  totalRefundedCents: number;
  netPoolCents: number;
  totalPaidOutCents: number;
  netBalanceCents: number;
}

const STATUS_LABELS: Record<string, string> = {
  captured: "Received",
  succeeded: "Paid",
  refunded: "Refunded",
  failed: "Failed",
  unclaimed: "Unclaimed",
  drafted: "Ready to send",
  approved: "Sending",
  pending: "Pending",
  created: "Pending",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ");
}

function StatusBadge({ status }: { status: string }) {
  const isGood = status === "captured" || status === "succeeded";
  const isRefund = status === "refunded";
  const isProblem = status === "failed" || status === "unclaimed";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 type-caption font-medium ${
        isGood
          ? "bg-pitch-tint text-pitch-dark"
          : isRefund
            ? "bg-line text-ink-2"
            : isProblem
              ? "bg-red-tint text-red-ink"
              : "bg-yellow-tint text-yellow-ink"
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}

function directionLabel(direction: LedgerEntryRow["direction"]): string {
  return direction === "in" ? "Money in" : direction === "refund" ? "Refund" : "Payout";
}

/** Signed amount: money in is positive, refunds and payouts are negative. */
function SignedAmount({ row }: { row: LedgerEntryRow }) {
  return (
    <span
      className={`font-semibold tabular-nums ${row.direction === "in" ? "text-pitch-dark" : "text-ink"}`}
    >
      {row.direction === "in" ? "+" : "-"}
      {formatUsd(row.amountCents)}
    </span>
  );
}

function Totals({ ledger }: { ledger: LedgerData }) {
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [
    { label: "Total entry fees received", value: formatUsd(ledger.totalCapturedCents) },
  ];
  if (ledger.totalRefundedCents > 0) {
    rows.push({ label: "Total refunded", value: `-${formatUsd(ledger.totalRefundedCents)}` });
  }
  rows.push({
    label: "Total paid out to winners",
    value: ledger.totalPaidOutCents > 0 ? `-${formatUsd(ledger.totalPaidOutCents)}` : formatUsd(0),
  });
  rows.push({
    label: "Still held by Umpra",
    value: formatUsd(ledger.netBalanceCents),
    strong: true,
  });

  return (
    <dl className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-paper type-small">
      {rows.map((row) => (
        <div
          key={row.label}
          className={`flex items-center justify-between gap-4 px-4 py-2.5 ${
            row.strong ? "bg-chalk font-semibold text-ink" : "text-ink-2"
          }`}
        >
          <dt>{row.label}</dt>
          <dd className="tabular-nums font-semibold text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LedgerTable({ ledger }: { ledger: LedgerData }) {
  const allRows: LedgerEntryRow[] = [
    ...ledger.entriesIn,
    ...ledger.refundsOut,
    ...ledger.payoutsOut,
  ];

  if (allRows.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-6 text-center">
          <p className="type-body text-muted">
            No payments yet. Entry fees and payouts will be listed here.
          </p>
        </div>
        <Totals ledger={ledger} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Phones: one row per payment, amount always visible */}
      <ul className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-paper sm:hidden">
        {allRows.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-1">
              <div className="type-small font-medium text-ink">
                {directionLabel(row.direction)}: {row.gamertag}
              </div>
              <div className="type-caption text-muted">{row.description}</div>
              <StatusBadge status={row.status} />
              {row.paypalId && (
                <div className="break-all font-mono type-caption text-muted">{row.paypalId}</div>
              )}
            </div>
            <div className="shrink-0 type-small">
              <SignedAmount row={row} />
            </div>
          </li>
        ))}
      </ul>

      {/* Tablet and up */}
      <div className="hidden overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-paper sm:block">
        <table className="w-full border-collapse text-left type-small">
          <caption className="sr-only">Payments in and out for this tournament</caption>
          <thead>
            <tr className="border-b border-line bg-chalk text-ink-2">
              <th scope="col" className="px-4 py-3 font-semibold">Type</th>
              <th scope="col" className="px-4 py-3 font-semibold">Player</th>
              <th scope="col" className="px-4 py-3 font-semibold">Description</th>
              <th scope="col" className="px-4 py-3 font-semibold">Status</th>
              <th scope="col" className="px-4 py-3 font-semibold">PayPal reference</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {allRows.map((row) => (
              <tr key={row.id} className="bg-paper">
                <td className="px-4 py-3 font-medium text-ink">{directionLabel(row.direction)}</td>
                <td className="px-4 py-3 font-medium text-ink">{row.gamertag}</td>
                <td className="px-4 py-3 text-muted">{row.description}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3 font-mono type-caption text-muted">{row.paypalId ?? "-"}</td>
                <td className="px-4 py-3 text-right">
                  <SignedAmount row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Totals ledger={ledger} />
    </div>
  );
}
