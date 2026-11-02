"use client";

import * as React from "react";
import { Panel } from "@/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import { ScreenshotUploader } from "./ScreenshotUploader";
import type { BracketMatchItem } from "./BracketView";

export function PlayerMatchPanel({
  playerId,
  gamertag,
  matches,
  onRefresh,
}: {
  playerId: string;
  gamertag: string;
  matches: BracketMatchItem[];
  onRefresh?: () => void;
}) {
  // Find active or most recent match for this player
  const playerMatches = matches
    .filter((m) => m.playerAId === playerId || m.playerBId === playerId)
    .sort((a, b) => b.round - a.round);

  const currentMatch =
    playerMatches.find(
      (m) => m.status === "awaiting_results" || m.status === "disputed"
    ) ?? playerMatches[0];

  if (!currentMatch) {
    return (
      <Panel className="space-y-1">
        <h2 className="type-h3">You&apos;re registered as {gamertag}</h2>
        <p className="type-small text-muted">
          Waiting for all 8 players to complete checkout so Umpra can draw the bracket.
        </p>
      </Panel>
    );
  }

  const isPlayerA = currentMatch.playerAId === playerId;
  const opponentTag = isPlayerA
    ? (currentMatch.playerBGamertag ?? "Opponent")
    : (currentMatch.playerAGamertag ?? "Opponent");

  const roundLabel =
    currentMatch.round === 1
      ? "Round 1 (Quarter-final)"
      : currentMatch.round === 2
        ? "Round 2 (Semi-final)"
        : "Final";

  const mySub = currentMatch.submissions.find((s) => s.playerId === playerId);
  const oppSub = currentMatch.submissions.find((s) => s.playerId !== playerId);

  const canReplace =
    currentMatch.status === "awaiting_results";

  const score = currentMatch.scoreA !== null && currentMatch.scoreB !== null ? ` ${currentMatch.scoreA}-${currentMatch.scoreB}` : "";

  return (
    <Panel className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="type-caption text-muted">Your match</div>
          <h2 className="type-h3">
            {roundLabel}: {gamertag} vs {opponentTag}
          </h2>
        </div>
      </div>

      {currentMatch.status === "confirmed" && (
        <Banner
          variant={currentMatch.winnerId === playerId ? "info" : "attention"}
        >
          {currentMatch.winnerId === playerId
            ? `Confirmed: you won${score}.`
            : `Confirmed: ${currentMatch.winnerGamertag} won${score}.`}
        </Banner>
      )}

      {currentMatch.status === "disputed" && (
        <Banner variant="problem">
          Under host review.{" "}
          {currentMatch.dispute?.summary ??
            "The host is reviewing both submitted screenshots."}
        </Banner>
      )}

      {currentMatch.status === "awaiting_results" && (
        <>
          {mySub && !oppSub && (
            <Banner variant="attention">
              Waiting for {opponentTag} to submit their screenshot.
            </Banner>
          )}
          {mySub && oppSub && (
            <Banner variant="info">
              Umpra is checking both screenshots.
            </Banner>
          )}

          <ScreenshotUploader
            matchId={currentMatch.id}
            existingSubmissionId={mySub?.id ?? null}
            canReplace={canReplace}
            onUploaded={onRefresh}
          />
        </>
      )}
    </Panel>
  );
}
