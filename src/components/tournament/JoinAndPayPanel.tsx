"use client";

import * as React from "react";
import { Panel } from "@/components/ui/panel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { formatUsd } from "@/lib/money";

export function JoinAndPayPanel({
  tournamentId,
  entryFeeCents,
  defaultGamertag = "",
  defaultPaypalEmail = "",
}: {
  tournamentId: string;
  entryFeeCents: number;
  defaultGamertag?: string;
  defaultPaypalEmail?: string;
}) {
  const [gamertag, setGamertag] = React.useState(defaultGamertag);
  const [paypalEmail, setPaypalEmail] = React.useState(
    defaultPaypalEmail
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gamertag: gamertag.trim(),
          paypalEmail: paypalEmail.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data?.error?.message ??
            "Could not start PayPal checkout. Check your details and try again."
        );
        return;
      }

      if (data.approveUrl) {
        window.location.href = data.approveUrl;
      }
    } catch {
      setError("Network error while starting checkout. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel className="space-y-4 border-pitch">
      <div className="space-y-1">
        <h2 className="type-h3">Join this tournament</h2>
        <p className="type-small text-muted">
          Enter the gamertag shown on your scoreboard and your PayPal email for prize payouts.
        </p>
      </div>

      <form onSubmit={handleJoin} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Gamertag (exact in-game name)"
            value={gamertag}
            onChange={(e) => setGamertag(e.target.value)}
            helperText="Umpra matches this name on result screenshots"
            required
          />
          <Input
            label="PayPal email (for prize payouts)"
            type="email"
            value={paypalEmail}
            onChange={(e) => setPaypalEmail(e.target.value)}
            helperText="Sandbox personal account email"
            required
          />
        </div>

        {error && <Banner variant="problem">{error}</Banner>}

        <Button
          type="submit"
          variant="primary"
          loading={loading}
          disabled={gamertag.trim().length < 2 || !paypalEmail.includes("@")}
        >
          Join for {formatUsd(entryFeeCents)}
        </Button>
      </form>
    </Panel>
  );
}
