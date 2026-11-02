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
      {status}
    </span>
  );
}

export function LedgerTable({ ledger }: { ledger: LedgerData }) {
  const allRows: LedgerEntryRow[] = [
    ...ledger.entriesIn,
    ...ledger.refundsOut,
    ...ledger.payoutsOut,
  ];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-paper">
        <table className="w-full min-w-[540px] border-collapse text-left type-small">
          <thead>
            <tr className="border-b border-line bg-chalk text-ink-2">
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Player</th>
              <th className="px-4 py-3 font-semibold">Description</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">PayPal reference</th>
              <th className="px-4 py-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {allRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  No payments or payouts recorded yet.
                </td>
              </tr>
            ) : (
              allRows.map((row) => (
                <tr key={row.id} className="bg-paper">
                  <td className="px-4 py-3 font-medium text-ink">
                    {row.direction === "in"
                      ? "Money in"
                      : row.direction === "refund"
                        ? "Refund"
                        : "Payout"}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">
                    {row.gamertag}
                  </td>
                  <td className="px-4 py-3 text-muted">{row.description}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 font-mono type-caption text-muted">
                    {row.paypalId ?? "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold tabular-nums ${
                      row.direction === "in"
                        ? "text-pitch"
                        : "text-ink"
                    }`}
                  >
                    {row.direction === "in" ? "+" : "-"}
                    {formatUsd(row.amountCents)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="border-t-2 border-line-strong bg-chalk type-small">
            <tr>
              <td colSpan={5} className="px-4 py-2.5 text-ink-2">
                Total entry fees captured
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                {formatUsd(ledger.totalCapturedCents)}
              </td>
            </tr>
            {ledger.totalRefundedCents > 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-2.5 text-ink-2">
                  Total refunded
                </td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                  -{formatUsd(ledger.totalRefundedCents)}
                </td>
              </tr>
            )}
            <tr>
              <td colSpan={5} className="px-4 py-2.5 text-ink-2">
                Total paid out to winners
              </td>
              <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
                -{formatUsd(ledger.totalPaidOutCents)}
              </td>
            </tr>
            <tr className="border-t border-line font-semibold">
              <td colSpan={5} className="px-4 py-3 text-ink">
                Remaining held pool balance
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-ink">
                {formatUsd(ledger.netBalanceCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
