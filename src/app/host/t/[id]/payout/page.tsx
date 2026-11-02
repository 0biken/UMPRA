"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Banner } from "@/components/ui/banner";
import { StatePill } from "@/components/ui/state-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatUsd } from "@/lib/money";
import type { TournamentState } from "@/lib/tournament-view";

interface PayoutReviewResponse {
  tournamentId: string; tournamentTitle: string; tournamentState: TournamentState;
  poolCents: number; totalPayoutCents: number;
  recipients: Array<{ id: string; place: number; gamertag: string; paypalEmail: string | null; amountCents: number; status: string; paypalBatchId: string | null; error: string | null }>;
  trail: { confirmedMatchesCount: number; resolvedDisputesCount: number };
}

export default function PayoutReviewPage() {
  const params = useParams<{ id: string }>();
  const tournamentId = params.id;
  const { pushToast } = useToast();

  const [data, setData] = React.useState<PayoutReviewResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDialogOpen, setConfirmDialogOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [retryingId, setRetryingId] = React.useState<string | null>(null);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/payout`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json?.error?.message ?? "Could not load payout review."
        );
      }
      setData(json);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load payout review."
      );
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  React.useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void loadData(); }, 5000);
    return () => window.clearInterval(timer);
  }, [loadData]);

  async function handleConfirmAndSend() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/tournaments/${tournamentId}/payout/confirm`,
        {
          method: "POST",
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Could not send payout batch.");
        setConfirmDialogOpen(false);
        return;
      }

      setConfirmDialogOpen(false);
      pushToast("Payout confirmed", "info");
      await loadData();
    } catch {
      setError("Network error while confirming payout.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRetryItem(payoutId: string) {
    setRetryingId(payoutId);
    setError(null);
    try {
      const res = await fetch(
        `/api/tournaments/${tournamentId}/payout/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payoutId }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message ?? "Could not retry failed payout item.");
        return;
      }
      pushToast("Retried failed payout", "info");
      await loadData();
    } catch {
      setError("Network error while retrying payout.");
    } finally {
      setRetryingId(null);
    }
  }

  if (loading && !data) {
    return (
      <main
        className="mx-auto max-w-[920px] px-4 py-6 sm:px-6 lg:px-8 space-y-4"
        aria-busy="true"
      >
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-56 w-full" />
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="mx-auto max-w-[920px] px-4 py-6 sm:px-6 lg:px-8 space-y-4">
        <Banner variant="problem">{error}</Banner>
        <Link href={`/t/${tournamentId}`}>
          <Button variant="secondary">Back to tournament</Button>
        </Link>
      </main>
    );
  }

  if (!data) return null;

  const { recipients } = data;
  const tournament = { state: data.tournamentState, title: data.tournamentTitle };
  const evidenceSummary = { ...data.trail, totalMatchesCount: 7, finalMatchScore: null };
  const allDrafted =
    recipients.length > 0 && recipients.every((r) => r.status === "drafted");
  const allSucceeded =
    recipients.length > 0 && recipients.every((r) => r.status === "succeeded");
  const failedItems = recipients.filter(
    (r) => r.status === "failed" || r.status === "unclaimed"
  );
  const batchId = recipients.find((r) => r.paypalBatchId)?.paypalBatchId ?? null;

  return (
    <main className="mx-auto max-w-[920px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="type-h1">Payout review</h1>
            <StatePill state={tournament.state} />
          </div>
          <p className="type-small text-muted">
            {tournament.title} · {evidenceSummary.confirmedMatchesCount} matches
            confirmed, {evidenceSummary.resolvedDisputesCount} disputes resolved
            by you
          </p>
        </div>

        <Link href={`/t/${tournamentId}`}>
          <Button variant="secondary" size="compact">
            Back to tournament
          </Button>
        </Link>
      </div>

      {error && <Banner variant="problem">{error}</Banner>}

      {/* Success receipt banner (`06 §Copy rules`) */}
      {allSucceeded && (
        <Banner variant="info">
          Paid!{" "}
          {recipients
            .map((r) => `${formatUsd(r.amountCents)} to ${r.gamertag}`)
            .join(", ")}
          .
        </Banner>
      )}

      {/* Partial failure banner (`06 §Copy rules`) */}
      {failedItems.map((failed) => (
        <Banner
          key={failed.id}
          variant="problem"
          action={
            <Button
              variant="danger"
              size="compact"
              loading={retryingId === failed.id}
              onClick={() => handleRetryItem(failed.id)}
            >
              Retry this one
            </Button>
          }
        >
          {failed.gamertag}&apos;s payout failed:{" "}
          {failed.error ?? "Recipient account issue"}. The other payout went
          through. Retry this one.
        </Banner>
      ))}

      {/* Recipients and deterministic amounts table (`T-060`, `T-089`) */}
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="type-h2">Prize distribution</h2>
            <p className="type-small text-muted">
              Amounts are computed deterministically from the captured{" "}
              {formatUsd(data.poolCents)} prize pool.
            </p>
          </div>
          {batchId && (
            <div className="rounded-[var(--radius-field)] border border-line bg-chalk px-3 py-1.5">
              <div className="type-caption text-muted">PayPal batch ID</div>
              <div className="font-mono type-small text-ink">{batchId}</div>
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-[var(--radius-field)] border border-line">
          <table className="w-full min-w-[520px] border-collapse text-left type-small">
            <thead>
              <tr className="border-b border-line bg-chalk text-ink-2">
                <th className="px-4 py-3 font-semibold">Place</th>
                <th className="px-4 py-3 font-semibold">Winner</th>
                <th className="px-4 py-3 font-semibold">PayPal recipient</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {recipients.map((r) => (
                <tr key={r.id} className="bg-paper">
                  <td className="px-4 py-3 font-semibold text-ink">
                    {r.place === 1 ? "1st (Champion)" : "2nd (Runner-up)"}
                  </td>
                  <td className="px-4 py-3 font-medium text-ink">
                    {r.gamertag}
                  </td>
                  <td className="px-4 py-3 font-mono type-caption text-muted">
                    {r.paypalEmail}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 type-caption font-medium ${
                        r.status === "succeeded"
                          ? "bg-pitch-tint text-pitch-dark"
                          : r.status === "failed" || r.status === "unclaimed"
                            ? "bg-red-tint text-red-ink"
                            : "bg-yellow-tint text-yellow-ink"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">
                    {formatUsd(r.amountCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line-strong bg-chalk font-semibold">
              <tr>
                <td colSpan={4} className="px-4 py-3 text-ink">
                  Total payout (matches held prize pool)
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-pitch">
                  {formatUsd(data.totalPayoutCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Evidence trail summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-field)] border border-line bg-chalk p-3.5 type-small">
          <div className="flex items-center gap-2 text-ink">
            <ShieldCheck className="h-5 w-5 text-pitch" strokeWidth={1.75} />
            <span>
              {evidenceSummary.confirmedMatchesCount} of{" "}
              {evidenceSummary.totalMatchesCount} matches verified
              {evidenceSummary.finalMatchScore
                ? ` · Final score ${evidenceSummary.finalMatchScore}`
                : ""}
              {evidenceSummary.resolvedDisputesCount > 0
                ? ` · ${evidenceSummary.resolvedDisputesCount} dispute resolved by host`
                : " · 0 unresolved disputes"}
            </span>
          </div>

          {allDrafted && (
            <Button
              variant="primary"
              onClick={() => setConfirmDialogOpen(true)}
            >
              Confirm payout
            </Button>
          )}
          {allSucceeded && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-pitch">
              <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
              <span>All payouts completed</span>
            </span>
          )}
        </div>
      </Panel>

      {/* Irreversible confirmation dialog (`06 §Copy rules`, `07 §Components`) */}
      <Dialog
        open={confirmDialogOpen}
        onClose={() => setConfirmDialogOpen(false)}
        title={`This sends ${formatUsd(data.totalPayoutCents)} to ${recipients.length} PayPal accounts. Payments cannot be recalled.`}
        description="Once you confirm, Umpra submits the payout batch to PayPal Payouts immediately."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => setConfirmDialogOpen(false)}
            >
              Go back
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              onClick={handleConfirmAndSend}
            >
              Send payout
            </Button>
          </>
        }
      >
        <ul className="divide-y divide-line rounded-[var(--radius-field)] border border-line bg-chalk px-3 py-1 type-small">
          {recipients.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between py-2"
            >
              <span className="text-ink">
                {r.place === 1 ? "1st" : "2nd"} · {r.gamertag} ({r.paypalEmail})
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {formatUsd(r.amountCents)}
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </main>
  );
}
