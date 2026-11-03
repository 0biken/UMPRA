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
  const [fieldErrors, setFieldErrors] = React.useState<{
    gamertag?: string;
    paypalEmail?: string;
  }>({});

  function validate(): boolean {
    const next: typeof fieldErrors = {};
    if (gamertag.trim().length < 2) {
      next.gamertag = "Enter your gamertag exactly as it appears in the game.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail.trim())) {
      next.paypalEmail = "Enter the email address of the PayPal account that should receive prizes.";
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setError(null);
    let redirecting = false;
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

      if (typeof data.approveUrl !== "string") {
        setError("PayPal didn't return a checkout link. Try again in a moment.");
        return;
      }
      // Keep the button busy while the browser leaves for PayPal.
      redirecting = true;
      window.location.href = data.approveUrl;
    } catch {
      setError("Network error while starting checkout. Try again.");
    } finally {
      if (!redirecting) setLoading(false);
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

      <form onSubmit={handleJoin} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Gamertag (exact in-game name)"
            value={gamertag}
            onChange={(e) => {
              setGamertag(e.target.value);
              if (fieldErrors.gamertag) setFieldErrors((f) => ({ ...f, gamertag: undefined }));
            }}
            helperText="Umpra matches this name on result screenshots"
            error={fieldErrors.gamertag}
            autoComplete="nickname"
            required
          />
          <Input
            label="PayPal email (for prize payouts)"
            type="email"
            value={paypalEmail}
            onChange={(e) => {
              setPaypalEmail(e.target.value);
              if (fieldErrors.paypalEmail) setFieldErrors((f) => ({ ...f, paypalEmail: undefined }));
            }}
            helperText="Sandbox personal account email"
            error={fieldErrors.paypalEmail}
            autoComplete="email"
            inputMode="email"
            required
          />
        </div>

        {error && <Banner variant="problem">{error}</Banner>}

        <div className="space-y-2">
          <Button type="submit" variant="primary" loading={loading}>
            Join for {formatUsd(entryFeeCents)}
          </Button>
          <p className="type-caption text-muted">
            You&apos;ll pay on PayPal and come straight back here. Your slot is held for 15 minutes
            while you pay.
          </p>
        </div>
      </form>
    </Panel>
  );
}
