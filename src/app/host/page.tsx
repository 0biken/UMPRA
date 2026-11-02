"use client";

import * as React from "react";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { StatePill } from "@/components/ui/state-pill";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Banner } from "@/components/ui/banner";
import { formatUsd } from "@/lib/money";
import type { TournamentState } from "@/lib/tournament-view";

interface HostTournamentItem {
  id: string;
  title: string;
  game: string;
  slots: number;
  entryFeeCents: number;
  state: TournamentState;
  paidCount: number;
  prizePoolCents: number;
  maxPrizePoolCents: number;
  createdAt: string;
}

export default function HostDashboardPage() {
  const [items, setItems] = React.useState<HostTournamentItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const meRes = await fetch("/api/auth/me");
        const meData = meRes.ok ? await meRes.json() : null;
        const hostId = meData?.user?.id;
        const url = hostId
          ? `/api/tournaments?hostId=${encodeURIComponent(hostId)}`
          : "/api/tournaments";
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error?.message ?? "Could not load tournaments.");
        }
        if (!cancelled) {
          setItems(data.tournaments ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not load tournaments."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-h1">My tournaments</h1>
          <p className="type-small text-muted">
            Manage registration, settle disputes, and confirm winner payouts.
          </p>
        </div>
        <Button asChild variant="primary">
          <Link href="/host/new">New tournament</Link>
        </Button>
      </div>

      {error && <Banner variant="problem">{error}</Banner>}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading tournaments">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          message="No tournaments yet. Create your first one."
          action={
            <Button asChild variant="primary">
              <Link href="/host/new">New tournament</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((t) => (
            <Panel
              key={t.id}
              className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Link
                    href={`/t/${t.id}`}
                    className="type-h3 text-ink hover:text-pitch transition-colors"
                  >
                    {t.title}
                  </Link>
                  <StatePill state={t.state} />
                </div>
                <p className="type-small text-muted">
                  {t.game} · {formatUsd(t.entryFeeCents)} entry · {t.paidCount} of{" "}
                  {t.slots} players paid
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <div className="text-left sm:text-right">
                  <div className="type-caption text-muted">Prize pool</div>
                  <div className="type-h3 tabular-nums text-ink">
                    {formatUsd(t.prizePoolCents)}{" "}
                    <span className="type-small font-normal text-muted">
                      / {formatUsd(t.maxPrizePoolCents)}
                    </span>
                  </div>
                </div>
                <Button asChild variant="secondary" size="compact">
                  <Link href={`/t/${t.id}`}>View</Link>
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </main>
  );
}
