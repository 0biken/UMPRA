"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatePill } from "@/components/ui/state-pill";

export type BracketMatchItem = import("@/lib/tournament-view").MatchView;

function getStatusLabel(m: BracketMatchItem): {
  text: string;
  tone: "muted" | "pitch" | "yellow" | "red";
} {
  if (m.status === "confirmed") {
    return { text: "Confirmed", tone: "pitch" };
  }
  if (m.status === "disputed") {
    return { text: "Needs host", tone: "red" };
  }
  if (m.status === "awaiting_results") {
    if (m.submissions.length >= 2) {
      return { text: "Checking", tone: "yellow" };
    }
    return { text: "In play", tone: "pitch" };
  }
  return { text: "Waiting", tone: "muted" };
}

export function MatchCard({
  match,
  onSelect,
}: {
  match: BracketMatchItem;
  onSelect?: (match: BracketMatchItem) => void;
}) {
  const isConfirmed = match.status === "confirmed";
  const aWon = isConfirmed && match.winnerId === match.playerAId;
  const bWon = isConfirmed && match.winnerId === match.playerBId;
  const statusInfo = getStatusLabel(match);

  return (
    <div className="inline-flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => onSelect?.(match)}
        className={`w-[180px] sm:w-[160px] h-[64px] rounded-[var(--radius-field)] border bg-paper text-left transition-colors focus-visible:outline-2 focus-visible:outline-pitch ${
          match.status === "disputed"
            ? "border-card-red"
            : isConfirmed
              ? "border-pitch"
              : "border-line hover:border-line-strong"
        }`}
        aria-label={`Round ${match.round} match ${match.position + 1}: ${
          match.playerAGamertag ?? "TBD"
        } vs ${match.playerBGamertag ?? "TBD"}, status ${statusInfo.text}`}
      >
        <div
          className={`flex h-[31px] items-center justify-between border-b border-line px-2.5 type-small ${
            aWon
              ? "border-l-[3px] border-l-pitch font-semibold text-ink"
              : isConfirmed
                ? "text-muted"
                : "text-ink"
          }`}
        >
          <span className="truncate pr-2">
            {match.playerAGamertag ?? "Waiting"}
          </span>
          <span
            className={`tabular-nums ${
              aWon ? "font-bold text-pitch" : "text-muted"
            }`}
          >
            {match.scoreA ?? "-"}
          </span>
        </div>
        <div
          className={`flex h-[31px] items-center justify-between px-2.5 type-small ${
            bWon
              ? "border-l-[3px] border-l-pitch font-semibold text-ink"
              : isConfirmed
                ? "text-muted"
                : "text-ink"
          }`}
        >
          <span className="truncate pr-2">
            {match.playerBGamertag ?? "Waiting"}
          </span>
          <span
            className={`tabular-nums ${
              bWon ? "font-bold text-pitch" : "text-muted"
            }`}
          >
            {match.scoreB ?? "-"}
          </span>
        </div>
      </button>

      {!isConfirmed && (
        <div className="flex items-center gap-1.5 px-0.5 type-caption">
          {statusInfo.tone === "red" ? (
            <span className="inline-flex items-center gap-1 rounded-[var(--radius-field)] bg-red-tint px-1.5 py-0.5 font-medium text-red-ink">
              <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
              <span>Needs host</span>
            </span>
          ) : statusInfo.tone === "yellow" ? (
            <span className="inline-flex items-center gap-1 rounded-[var(--radius-field)] bg-yellow-tint px-1.5 py-0.5 font-medium text-yellow-ink">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              <span>Checking</span>
            </span>
          ) : (
            <span className="text-muted">{statusInfo.text}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function BracketView({
  tournamentId,
  matches,
  isHost = false,
}: {
  tournamentId: string;
  matches: BracketMatchItem[];
  isHost?: boolean;
}) {
  const [mobileView, setMobileView] = React.useState<
    "r1" | "r2" | "r3" | "full"
  >("r1");
  const [selectedMatch, setSelectedMatch] =
    React.useState<BracketMatchItem | null>(null);
  const round1 = matches
    .filter((m) => m.round === 1)
    .sort((a, b) => a.position - b.position);
  const round2 = matches
    .filter((m) => m.round === 2)
    .sort((a, b) => a.position - b.position);
  const round3 = matches
    .filter((m) => m.round === 3)
    .sort((a, b) => a.position - b.position);

  if (matches.length === 0) {
    return (
      <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-6 text-center space-y-2">
        <p className="type-body text-ink">
          Umpra draws the 8-player bracket automatically once all 8 slots are filled.
        </p>
        <p className="type-small text-muted">
          Check the Players tab to watch slots fill in real time.
        </p>
      </div>
    );
  }

  // Coordinates for full SVG chalk-line bracket (width 640, height 390)
  // Round 1 (x = 12): y = 16, 108, 200, 292 (center Y = 48, 140, 232, 324)
  // Round 2 (x = 240): y = 62, 246 (center Y = 94, 278)
  // Round 3 (x = 468): y = 154 (center Y = 186)
  const r1Y = [16, 108, 200, 292];
  const r2Y = [62, 246];
  const r3Y = [154];

  const connectorPaths = [
    // QF 0 -> SF 0
    {
      match: round1[0],
      d: "M 172 48 H 206 V 94 H 240",
      length: 120,
    },
    // QF 1 -> SF 0
    {
      match: round1[1],
      d: "M 172 140 H 206 V 94 H 240",
      length: 120,
    },
    // QF 2 -> SF 1
    {
      match: round1[2],
      d: "M 172 232 H 206 V 278 H 240",
      length: 120,
    },
    // QF 3 -> SF 1
    {
      match: round1[3],
      d: "M 172 324 H 206 V 278 H 240",
      length: 120,
    },
    // SF 0 -> Final
    {
      match: round2[0],
      d: "M 400 94 H 434 V 186 H 468",
      length: 165,
    },
    // SF 1 -> Final
    {
      match: round2[1],
      d: "M 400 278 H 434 V 186 H 468",
      length: 165,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Mobile round selector */}
      <div className="flex flex-wrap items-center gap-1.5 md:hidden">
        {[
          { key: "full", label: "Full bracket" },
          { key: "r1", label: "Quarter-finals" },
          { key: "r2", label: "Semi-finals" },
          { key: "r3", label: "Final" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() =>
              setMobileView(tab.key as "r1" | "r2" | "r3" | "full")
            }
            className={`rounded-[var(--radius-control)] border px-3 py-1.5 type-small font-medium transition-colors ${
              mobileView === tab.key
                ? "border-pitch bg-pitch text-paper"
                : "border-line bg-paper text-ink-2"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mobile single-round stack view */}
      {mobileView !== "full" && (
        <div className="grid gap-3 md:hidden">
          {(mobileView === "r1"
            ? round1
            : mobileView === "r2"
              ? round2
              : round3
          ).map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-[var(--radius-panel)] border border-line bg-paper p-3"
            >
              <MatchCard match={m} onSelect={setSelectedMatch} />
              <Button
                variant="ghost"
                size="compact"
                onClick={() => setSelectedMatch(m)}
              >
                Details
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Full SVG chalk-line bracket (desktop and mobile "Full bracket" scrollable view) */}
      <div
        className={`${
          mobileView === "full" ? "block" : "hidden md:block"
        } overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-paper p-4 sm:p-6`}
      >
        <div className="min-w-[640px]">
          <div className="mb-3 grid grid-cols-3 type-caption font-semibold text-muted">
            <div>Quarter-finals</div>
            <div className="pl-6">Semi-finals</div>
            <div className="pl-12">Final</div>
          </div>

          <div className="relative h-[380px] w-[640px]">
            <svg
              viewBox="0 0 640 380"
              className="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true"
            >
              {/* Base chalk lines */}
              {connectorPaths.map((cp, idx) => (
                <path
                  key={`base-${idx}`}
                  d={cp.d}
                  fill="none"
                  stroke="var(--color-line-strong)"
                  strokeWidth="2"
                />
              ))}

              {/* Animated winner lines */}
              {connectorPaths.map((cp, idx) => {
                if (cp.match?.status !== "confirmed") return null;
                return (
                  <path
                    key={`win-${idx}`}
                    d={cp.d}
                    fill="none"
                    stroke="var(--color-pitch)"
                    strokeWidth="2.5"
                    strokeDasharray={cp.length}
                    strokeDashoffset="0"
                    className="umpra-bracket-winner-line"
                    style={{ "--path-length": cp.length } as React.CSSProperties}
                  />
                );
              })}
            </svg>

            {/* Round 1 cards */}
            {round1.map((m, idx) => (
              <div
                key={m.id}
                style={{ left: 12, top: r1Y[idx] }}
                className="absolute"
              >
                <MatchCard match={m} onSelect={setSelectedMatch} />
              </div>
            ))}

            {/* Round 2 cards */}
            {round2.map((m, idx) => (
              <div
                key={m.id}
                style={{ left: 240, top: r2Y[idx] }}
                className="absolute"
              >
                <MatchCard match={m} onSelect={setSelectedMatch} />
              </div>
            ))}

            {/* Round 3 Final card */}
            {round3.map((m, idx) => (
              <div
                key={m.id}
                style={{ left: 468, top: r3Y[idx] }}
                className="absolute"
              >
                <MatchCard match={m} onSelect={setSelectedMatch} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Match detail dialog */}
      <Dialog
        open={selectedMatch !== null}
        onClose={() => setSelectedMatch(null)}
        title={
          selectedMatch
            ? `${
                selectedMatch.round === 1
                  ? "Quarter-final"
                  : selectedMatch.round === 2
                    ? "Semi-final"
                    : "Final"
              } · ${selectedMatch.playerAGamertag ?? "Waiting"} vs ${
                selectedMatch.playerBGamertag ?? "Waiting"
              }`
            : "Match details"
        }
        description={
          selectedMatch?.status === "confirmed"
            ? `Confirmed result: ${selectedMatch.winnerGamertag} won ${selectedMatch.scoreA}-${selectedMatch.scoreB}.`
            : selectedMatch?.status === "disputed"
              ? "Flagged by Umpra for host decision."
              : selectedMatch?.status === "awaiting_results"
                ? "Waiting for both players to upload match screenshots."
                : "Waiting for previous round winners."
        }
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setSelectedMatch(null)}
            >
              Close
            </Button>
            {isHost &&
              selectedMatch?.status === "disputed" &&
              selectedMatch.dispute && (
                <Link
                  href={`/host/t/${tournamentId}/disputes/${selectedMatch.dispute.id}`}
                >
                  <Button variant="primary">Resolve dispute</Button>
                </Link>
              )}
          </div>
        }
      >
        {selectedMatch && (
          <div className="space-y-3 pt-2 type-small">
            <div className="flex items-center justify-between rounded-[var(--radius-field)] border border-line bg-chalk px-3 py-2">
              <span className="text-muted">Status</span>
              {selectedMatch.status === "disputed" ? (
                <StatePill state="disputed" />
              ) : selectedMatch.status === "confirmed" ? (
                <span className="inline-flex items-center gap-1 font-medium text-pitch">
                  <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                  <span>Confirmed</span>
                </span>
              ) : (
                <span className="font-medium text-ink">
                  {selectedMatch.status === "awaiting_results"
                    ? "In play / awaiting screenshots"
                    : "Waiting for players"}
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="type-caption text-muted">
                Submitted screenshots ({selectedMatch.submissions.length} of 2)
              </div>
              {selectedMatch.submissions.length === 0 ? (
                <p className="text-muted">No screenshots uploaded yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {selectedMatch.submissions.map((sub) => (
                    <li
                      key={sub.id}
                      className="flex items-center justify-between rounded-[var(--radius-field)] border border-line px-3 py-1.5"
                    >
                      <span className="font-medium text-ink">
                        {sub.gamertag}
                      </span>
                      <span className="type-caption text-muted">
                        {sub.extractionStatus === "ok" && sub.confidence !== null
                          ? `Read (${Math.round(sub.confidence * 100)}% confidence)`
                          : sub.extractionStatus}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {selectedMatch.dispute?.summary && (
              <div className="rounded-[var(--radius-field)] border border-card-red bg-red-tint p-3 text-red-ink">
                <div className="font-semibold">Umpra report</div>
                <p className="mt-1">{selectedMatch.dispute.summary}</p>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
