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

interface BrowseTournamentItem {
  id: string;
  title: string;
  game: string;
  slots: number;
  entryFeeCents: number;
  state: TournamentState;
  paidCount: number;
  prizePoolCents: number;
  maxPrizePoolCents: number;
}

export default function PlayBrowsePage() {
  const [items, setItems] = React.useState<BrowseTournamentItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/tournaments?public=1")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setItems(data.tournaments ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load open tournaments.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div>
        <h1 className="type-h1">Tournaments</h1>
        <p className="type-small text-muted">
          Join an open 8-player tournament with PayPal sandbox checkout or check your match status.
        </p>
      </div>

      {error && <Banner variant="problem">{error}</Banner>}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState message="No open tournaments right now. Check back soon." />
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
                  {t.slots} slots filled
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
                <Button
                  asChild
                  variant={t.state === "open" ? "primary" : "secondary"}
                  size="compact"
                >
                  <Link href={`/t/${t.id}`}>
                    {t.state === "open"
                      ? `Join for ${formatUsd(t.entryFeeCents)}`
                      : "View bracket"}
                  </Link>
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </main>
  );
}
