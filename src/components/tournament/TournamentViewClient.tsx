"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Share2, Trophy } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { StatePill } from "@/components/ui/state-pill";
import { PrizePlate } from "@/components/ui/prize-plate";
import { Banner } from "@/components/ui/banner";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatUsd } from "@/lib/money";
import { BracketView } from "./BracketView";
import { ActivityLog } from "./ActivityLog";
import { LedgerTable } from "./LedgerTable";
import { JoinAndPayPanel } from "./JoinAndPayPanel";
import { PlayerMatchPanel } from "./PlayerMatchPanel";
import { DemoControlsPanel } from "./DemoControlsPanel";
import type { TournamentState, TournamentDetailsResponse } from "@/lib/tournament-view";

type TabKey = "bracket" | "players" | "activity" | "ledger";

export function TournamentViewClient({
  tournamentId,
  demoMode = false,
}: {
  tournamentId: string;
  demoMode?: boolean;
}) {
  const searchParams = useSearchParams();
  const paymentQuery = searchParams.get("payment");
  const { pushToast } = useToast();

  const [data, setData] = React.useState<TournamentDetailsResponse | null>(
    null
  );
  const [currentUser, setCurrentUser] = React.useState<{
    id: string;
    displayName: string;
    role: "host" | "player";
    paypalEmail?: string | null;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<TabKey | null>(null);
  const [liveAnnouncement, setLiveAnnouncement] = React.useState("");
  const [actionLoading, setActionLoading] = React.useState(false);
  const requestInFlight = React.useRef(false);

  const loadTournament = React.useCallback(
    async (silent = false) => {
      if (requestInFlight.current) return;
      requestInFlight.current = true;
      if (!silent) setLoading(true);
      try {
        const [tRes, meRes] = await Promise.all([
          fetch(`/api/tournaments/${tournamentId}`),
          fetch("/api/auth/me"),
        ]);
        const tJson = await tRes.json();
        if (!tRes.ok) {
          throw new Error(
            tJson?.error?.message ?? "Could not load tournament."
          );
        }
        const meJson = meRes.ok ? await meRes.json() : null;
        setCurrentUser(meJson?.user ?? null);
        setData((prev) => {
          if (
            prev &&
            prev.tournament.state !== tJson.tournament.state
          ) {
            setLiveAnnouncement(
              `Tournament state updated to ${tJson.tournament.state}`
            );
          }
          return tJson;
        });
        setError(null);
      } catch (err) {
        if (!silent) {
          setError(
            err instanceof Error ? err.message : "Could not load tournament."
          );
        }
      } finally {
        requestInFlight.current = false;
        if (!silent) setLoading(false);
      }
    },
    [tournamentId]
  );

  React.useEffect(() => {
    loadTournament(false);
  }, [loadTournament]);

  // Set default tab based on state (`Players` while draft/open, `Bracket` once locked)
  React.useEffect(() => {
    if (!data || activeTab !== null) return;
    if (data.tournament.state === "draft" || data.tournament.state === "open") {
      setActiveTab("players");
    } else {
      setActiveTab("bracket");
    }
  }, [data, activeTab]);

  const liveState = data?.tournament.state;

  // Poll every 5 seconds while active; pause when tab is hidden (`06 §Agent loop`)
  React.useEffect(() => {
    if (!liveState) return;
    const activeStates: TournamentState[] = [
      "open",
      "locked",
      "in_progress",
      "results_pending",
      "confirmed",
    ];
    if (!activeStates.includes(liveState)) return;

    const interval = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      loadTournament(true);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [liveState, loadTournament]);

  async function handleOpenRegistration() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/open`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        pushToast(
          json?.error?.message ?? "Could not open registration.",
          "problem"
        );
        return;
      }
      pushToast("Registration opened", "info");
      await loadTournament(true);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancelTournament() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Cancelled by host" }),
      });
      const json = await res.json();
      if (!res.ok) {
        pushToast(
          json?.error?.message ?? "Could not cancel tournament.",
          "problem"
        );
        return;
      }
      pushToast("Tournament cancelled and refunds triggered", "attention");
      await loadTournament(true);
    } finally {
      setActionLoading(false);
    }
  }

  function handleCopyShareLink() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/t/${tournamentId}`;
    navigator.clipboard?.writeText(url).then(() => {
      pushToast("Tournament link copied", "info");
    });
  }

  if (loading && !data) {
    return (
      <main
        className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-4"
        aria-busy="true"
      >
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-4">
        <Banner variant="problem">
          {error ?? "Tournament could not be found."}
        </Banner>
        <Button asChild variant="secondary">
          <Link href="/play">Browse open tournaments</Link>
        </Button>
      </main>
    );
  }

  const { tournament, entries, matches, ledger, activity } = data;
  const isHostOwner =
    currentUser?.role === "host" && currentUser.id === tournament.hostId;
  const myPaidEntry = entries.find(
    (e) => e.playerId === currentUser?.id && e.status === "paid"
  );
  const openDisputes = matches
    .filter((m) => m.status === "disputed" && m.dispute?.status === "open")
    .map((m) => ({ match: m, dispute: m.dispute! }));

  const filledEntries = entries.filter((entry) => entry.status === "paid");
  const realPaidCount = filledEntries.filter((entry) => !entry.simulated).length;
  const tab = activeTab ?? "bracket";

  // Demo controls (DEMO_MODE only). While the field is filling they sit above the tabs,
  // because that is when they are needed. Once play starts the bracket leads and they follow it.
  const demoPanel =
    demoMode && isHostOwner ? (
      <DemoControlsPanel
        tournamentId={tournament.id}
        state={tournament.state}
        paidCount={data.paidCount}
        matches={matches}
        onUpdated={() => loadTournament(true)}
      />
    ) : null;
  const demoFirst = tournament.state === "draft" || tournament.state === "open";
  const tabItems: Array<{ key: TabKey; label: string }> = [
    { key: "bracket", label: "Bracket" },
    { key: "players", label: `Players (${data.paidCount}/${tournament.slots})` },
    { key: "activity", label: `Activity (${activity.length})` },
    { key: "ledger", label: "Ledger" },
  ];

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div className="sr-only" aria-live="polite">
        {liveAnnouncement}
      </div>

      {/* Payment return banners (`06 §Copy rules`) */}
      {paymentQuery === "paid" && (
        <Banner variant="info">
          You&apos;re in. Your slot is reserved and your entry fee is in the prize pool.
        </Banner>
      )}
      {paymentQuery === "cancelled" && (
        <Banner variant="attention">
          Payment cancelled. Your slot is free again. Join again whenever you&apos;re ready.
        </Banner>
      )}
      {paymentQuery === "overflow_refunded" && (
        <Banner variant="attention">
          This tournament filled up while you were paying. We&apos;ve refunded{" "}
          {formatUsd(tournament.entryFeeCents)} to your PayPal.
        </Banner>
      )}
      {paymentQuery === "failed" && (
        <Banner variant="problem">
          We couldn&apos;t verify that checkout. Your slot is free if you want to try again.
        </Banner>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="type-h1">{tournament.title}</h1>
            <StatePill state={tournament.state} />
          </div>
          <p className="type-small flex flex-wrap gap-x-4 gap-y-0.5 text-muted">
            <span>{tournament.game}</span>
            <span>{formatUsd(tournament.entryFeeCents)} entry</span>
            <span>Hosted by {tournament.hostDisplayName}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="compact"
            onClick={handleCopyShareLink}
          >
            <Share2 className="mr-1.5 h-4 w-4" strokeWidth={1.75} />
            <span>Share link</span>
          </Button>
          {isHostOwner &&
            (tournament.state === "draft" || tournament.state === "open") && (
              <Button
                variant="danger"
                size="compact"
                loading={actionLoading}
                onClick={handleCancelTournament}
              >
                Cancel tournament
              </Button>
            )}
        </div>
      </div>

      {/* PrizePlate */}
      <PrizePlate
        poolCents={data.prizePoolCents}
        maxPoolCents={data.maxPrizePoolCents}
        paidSlots={data.paidCount}
        simulatedSlots={
          entries.filter((e) => e.status === "paid" && e.simulated).length
        }
        totalSlots={tournament.slots}
      />

      {/* Champion callout when confirmed or paid */}
      {(tournament.state === "confirmed" || tournament.state === "paid") &&
        tournament.championGamertag && (
          <Panel className="flex flex-wrap items-center justify-between gap-4 border-pitch bg-pitch-tint/50">
            <div className="flex items-center gap-3">
              <Trophy className="h-6 w-6 text-pitch" strokeWidth={1.75} />
              <div>
                <div className="type-caption text-pitch-dark">
                  Tournament results confirmed
                </div>
                <div className="type-h3 text-ink">
                  1st: {tournament.championGamertag}
                  {tournament.runnerUpGamertag
                    ? `, 2nd: ${tournament.runnerUpGamertag}`
                    : ""}
                </div>
              </div>
            </div>
            {isHostOwner && (
              <Button asChild variant="primary">
                <Link href={`/host/t/${tournament.id}/payout`}>
                  {tournament.state === "paid"
                    ? "View payout receipt"
                    : "Review and confirm payout"}
                </Link>
              </Button>
            )}
          </Panel>
        )}

      {/* Host action banners */}
      {isHostOwner && tournament.state === "draft" && (
        <Banner
          variant="attention"
          action={
            <Button
              variant="primary"
              size="compact"
              loading={actionLoading}
              onClick={handleOpenRegistration}
            >
              Open registration
            </Button>
          }
        >
          This tournament is still in draft. Terms lock once you open registration.
        </Banner>
      )}

      {isHostOwner && openDisputes.length > 0 && (
        <Banner
          variant="problem"
          action={
            <Button asChild variant="danger" size="compact">
              <Link
                href={`/host/t/${tournament.id}/disputes/${openDisputes[0].dispute.id}`}
              >
                Resolve dispute
              </Link>
            </Button>
          }
        >
          {openDisputes.length === 1
            ? "1 match needs your decision."
            : `${openDisputes.length} matches need your decision.`}
        </Banner>
      )}

      {isHostOwner && tournament.state === "confirmed" && (
        <Banner
          variant="attention"
          action={
            <Button asChild variant="primary" size="compact">
              <Link href={`/host/t/${tournament.id}/payout`}>Review payout</Link>
            </Button>
          }
        >
          Final confirmed. Review the payout.
        </Banner>
      )}

      {/* Player action panels */}
      {myPaidEntry && (
        <PlayerMatchPanel
          playerId={myPaidEntry.playerId}
          gamertag={myPaidEntry.gamertag}
          matches={matches}
          onRefresh={() => loadTournament(true)}
        />
      )}

      {!myPaidEntry &&
        tournament.state === "open" &&
        data.paidCount < tournament.slots &&
        currentUser?.role !== "host" && (
          <div>
            {currentUser ? (
              <JoinAndPayPanel
                tournamentId={tournament.id}
                entryFeeCents={tournament.entryFeeCents}
                // Display names can carry a suffix such as "(Demo Player)" that no scoreboard shows.
                defaultGamertag={currentUser.displayName.replace(/\s*\([^)]*\)\s*$/, "")}
                defaultPaypalEmail={currentUser.paypalEmail ?? ""}
              />
            ) : (
              <Panel className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="type-h3">Want to play in this tournament?</h2>
                  <p className="type-small text-muted">
                    Sign in as a player to pay the{" "}
                    {formatUsd(tournament.entryFeeCents)} entry fee and claim a slot.
                  </p>
                </div>
                <Button asChild variant="primary">
                  <Link href={`/login?next=/t/${tournament.id}`}>
                    Join for {formatUsd(tournament.entryFeeCents)}
                  </Link>
                </Button>
              </Panel>
            )}
          </div>
        )}

      {demoFirst && demoPanel}

      {/* Navigation Tabs (`Bracket`, `Players`, `Activity`, `Ledger`) */}
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Tournament views"
          className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
          onKeyDown={(event) => {
            const keys = tabItems.map((item) => item.key);
            const index = keys.indexOf(tab);
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % keys.length;
            else if (event.key === "ArrowLeft") next = (index - 1 + keys.length) % keys.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = keys.length - 1;
            else return;
            event.preventDefault();
            setActiveTab(keys[next]);
            document.getElementById(`tab-${keys[next]}`)?.focus();
          }}
        >
          {tabItems.map((item) => (
            <button
              key={item.key}
              id={`tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              aria-controls="tournament-tabpanel"
              tabIndex={tab === item.key ? 0 : -1}
              onClick={() => setActiveTab(item.key)}
              className={`min-h-11 shrink-0 border-b-2 px-3.5 type-small font-medium transition-colors duration-[var(--dur-fast)] ${
                tab === item.key
                  ? "border-pitch text-pitch-dark"
                  : "border-transparent text-ink-2 hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          id="tournament-tabpanel"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          className="space-y-4"
        >
          {tab === "bracket" && (
            <BracketView
              tournamentId={tournament.id}
              matches={matches}
              isHost={isHostOwner}
            />
          )}

          {tab === "players" && (
            <Panel className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="type-h3">
                  Registered players ({filledEntries.length} of {tournament.slots} slots filled, {realPaidCount} paid)
                </h2>
              </div>
              {filledEntries.length === 0 ? (
                <p className="type-small text-muted py-4">
                  No registered players yet. Share the tournament link so players can join.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {filledEntries.map((entry, idx) => (
                      <li
                        key={entry.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2.5 type-small"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pitch-tint type-caption font-semibold text-pitch-dark tabular-nums">
                            {idx + 1}
                          </span>
                          <span className="font-medium text-ink">
                            {entry.gamertag}
                          </span>
                          {entry.simulated && (
                            <span className="rounded-full border border-line bg-chalk px-2 py-0.5 type-caption text-muted">
                              simulated demo player
                            </span>
                          )}
                        </div>
                        <span className="rounded-full bg-pitch-tint px-2.5 py-0.5 type-caption font-medium text-pitch-dark">
                          {entry.simulated ? "No payment (demo)" : `Paid ${formatUsd(tournament.entryFeeCents)}`}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </Panel>
          )}

          {tab === "activity" && <ActivityLog items={activity} />}

          {tab === "ledger" && <LedgerTable ledger={ledger} />}
        </div>
      </div>

      {!demoFirst && demoPanel}
    </main>
  );
}
