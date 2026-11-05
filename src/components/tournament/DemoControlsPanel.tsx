"use client";

import * as React from "react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import type { BracketMatchItem } from "./BracketView";
import type { TournamentState } from "@/lib/tournament-view";

export function DemoControlsPanel({
  tournamentId,
  state,
  paidCount,
  matches,
  onUpdated,
}: {
  tournamentId: string;
  state: TournamentState;
  paidCount: number;
  matches: BracketMatchItem[];
  onUpdated?: () => void;
}) {
  const { pushToast } = useToast();
  const [filling, setFilling] = React.useState(false);
  const [submittingMatchId, setSubmittingMatchId] = React.useState<
    string | null
  >(null);
  const [scenario, setScenario] = React.useState<
    "agree" | "mismatch" | "unreadable" | "wrong_players"
  >("agree");
  const [error, setError] = React.useState<string | null>(null);

  const awaitingMatches = matches.filter(
    (m) => m.status === "awaiting_results"
  );

  async function handleFill() {
    setFilling(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/fill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Could not fill demo players.");
        return;
      }
      pushToast(
        `Added ${data.addedCount} simulated demo players and drew bracket`,
        "info"
      );
      onUpdated?.();
    } catch {
      setError("Network error while adding demo players.");
    } finally {
      setFilling(false);
    }
  }

  async function handleSubmitMatch(matchId: string) {
    setSubmittingMatchId(matchId);
    setError(null);
    try {
      const res = await fetch("/api/demo/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, scenario }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Could not submit demo screenshots.");
        return;
      }
      pushToast(
        scenario === "agree"
          ? "Submitted agreeing screenshots"
          : "Submitted disputed screenshots",
        scenario === "agree" ? "info" : "attention"
      );
      onUpdated?.();
    } catch {
      setError("Network error while submitting demo screenshots.");
    } finally {
      setSubmittingMatchId(null);
    }
  }

  if (state !== "open" && awaitingMatches.length === 0) {
    return null;
  }

  return (
    <Panel className="space-y-4 border-card-yellow bg-yellow-tint/40">
      <div className="space-y-1">
        <h2 className="type-h3 text-yellow-ink">
          Solo judge demo controls (simulated demo players)
        </h2>
        <p className="type-small text-yellow-ink">
          Use these controls to fill remaining slots with simulated demo players or submit generated scoreboard screenshots without needing 8 separate people.
        </p>
      </div>

      {state === "open" && paidCount < 8 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            loading={filling}
            onClick={handleFill}
          >
            Fill remaining {8 - paidCount} slots with demo players
          </Button>
        </div>
      )}

      {awaitingMatches.length > 0 && (
        <div className="space-y-3 border-t border-line pt-3">
          <div className="max-w-xs">
            <SelectField
              label="Demo screenshot scenario"
              value={scenario}
              onChange={(e) =>
                setScenario(
                  e.target.value as "agree" | "mismatch" | "unreadable" | "wrong_players"
                )
              }
              options={[
                { value: "wrong_players", label: "Wrong players (opens dispute)" },
                {
                  value: "agree",
                  label: "Agreeing screenshots (3-1, auto-confirms)",
                },
                {
                  value: "mismatch",
                  label: "Conflicting screenshots (2-1 vs 1-2, opens dispute)",
                },
                {
                  value: "unreadable",
                  label: "Blurry screenshot (opens dispute)",
                },
              ]}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {awaitingMatches.map((m) => (
              <Button
                key={m.id}
                variant="secondary"
                size="compact"
                loading={submittingMatchId === m.id}
                onClick={() => handleSubmitMatch(m.id)}
              >
                Submit demo results: {m.playerAGamertag} vs {m.playerBGamertag}
              </Button>
            ))}
          </div>
        </div>
      )}

      {error && <Banner variant="problem">{error}</Banner>}
    </Panel>
  );
}
