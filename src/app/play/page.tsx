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

/** Messages for PayPal returns that land here instead of on a tournament page. */
const PAYMENT_BANNERS: Record<string, { variant: "attention" | "problem"; text: string }> = {
  cancelled: {
    variant: "attention",
    text: "Payment cancelled. Your slot is free again. Join again whenever you're ready.",
  },
  failed: {
    variant: "problem",
    text: "We couldn't confirm that payment with PayPal. Check your PayPal activity before you try again, and tell the host if you were charged.",
  },
  missing_entry: {
    variant: "problem",
    text: "That PayPal link didn't match an entry. Open the tournament and join again.",
  },
};

export default function PlayBrowsePage() {
  const [paymentBanner, setPaymentBanner] = React.useState<
    (typeof PAYMENT_BANNERS)[string] | null
  >(null);

  React.useEffect(() => {
    const key = new URLSearchParams(window.location.search).get("payment");
    if (key && PAYMENT_BANNERS[key]) setPaymentBanner(PAYMENT_BANNERS[key]);
  }, []);

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

      {paymentBanner && (
        <Banner variant={paymentBanner.variant}>{paymentBanner.text}</Banner>
      )}
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
                    className="-my-2.5 inline-block py-2.5 type-h3 text-ink hover:text-pitch transition-colors"
                  >
                    {t.title}
                  </Link>
                  <StatePill state={t.state} />
                </div>
                <p className="type-small flex flex-wrap gap-x-4 gap-y-0.5 text-muted">
                  <span>{t.game}</span>
                  <span>{formatUsd(t.entryFeeCents)} entry</span>
                  <span>
                    {t.paidCount} of {t.slots} slots filled
                  </span>
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
