"use client";

import * as React from "react";
import { Panel } from "@/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import { ScreenshotUploader } from "./ScreenshotUploader";
import type { BracketMatchItem } from "./BracketView";

function roundLabel(round: number): string {
  if (round === 1) return "Quarterfinal";
  if (round === 2) return "Semifinal";
  return "Final";
}

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
  const playerMatches = matches
    .filter((m) => m.playerAId === playerId || m.playerBId === playerId)
    .sort((a, b) => b.round - a.round);

  // The match that needs the player now, else the next one they are slotted into,
  // else the last one they played.
  const currentMatch =
    playerMatches.find(
      (m) => m.status === "awaiting_results" || m.status === "disputed"
    ) ??
    playerMatches.find((m) => m.status === "waiting") ??
    playerMatches[0];

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
    ? currentMatch.playerBGamertag
    : currentMatch.playerAGamertag;

  const myScore = isPlayerA ? currentMatch.scoreA : currentMatch.scoreB;
  const theirScore = isPlayerA ? currentMatch.scoreB : currentMatch.scoreA;
  const hasScore = myScore !== null && theirScore !== null;
  const iWon = currentMatch.winnerId === playerId;

  const mySub = currentMatch.submissions.find((s) => s.playerId === playerId);
  const oppSub = currentMatch.submissions.find((s) => s.playerId !== playerId);

  return (
    <Panel className="space-y-4">
      <div>
        <div className="type-caption text-muted">Your match</div>
        <h2 className="type-h3">
          {roundLabel(currentMatch.round)}: {gamertag} vs {opponentTag ?? "to be decided"}
        </h2>
      </div>

      {currentMatch.status === "waiting" && (
        <Banner variant="info">
          You&apos;re through. Your next opponent is decided when the other{" "}
          {roundLabel(currentMatch.round - 1).toLowerCase()} is confirmed.
        </Banner>
      )}

      {currentMatch.status === "confirmed" &&
        (iWon ? (
          <Banner variant="info">
            {currentMatch.round === 3
              ? `You won the tournament${hasScore ? ` ${myScore}-${theirScore}` : ""}. Your prize is paid after the host confirms the payout.`
              : `Confirmed: you won${hasScore ? ` ${myScore}-${theirScore}` : ""}.`}
          </Banner>
        ) : (
          <Banner variant="attention">
            Confirmed: {currentMatch.winnerGamertag} won
            {hasScore ? ` ${theirScore}-${myScore}` : ""}.{" "}
            {currentMatch.round === 3
              ? "You finished runner-up. Your prize is paid after the host confirms the payout."
              : "You're out of the tournament. Thanks for playing."}
          </Banner>
        ))}

      {currentMatch.status === "disputed" && (
        <Banner variant="problem">
          Under host review. The screenshots didn&apos;t agree, so the host will decide this match.
        </Banner>
      )}

      {currentMatch.status === "awaiting_results" && (
        <>
          {!mySub && (
            <p className="type-small text-ink-2">
              Play your match, then upload a screenshot of the final score.
            </p>
          )}
          {mySub && !oppSub && (
            <Banner variant="attention">
              Waiting for {opponentTag ?? "your opponent"} to submit their screenshot.
            </Banner>
          )}
          {mySub && oppSub && (
            <Banner variant="info">Umpra is checking both screenshots.</Banner>
          )}

          <ScreenshotUploader
            matchId={currentMatch.id}
            existingSubmissionId={mySub?.id ?? null}
            canReplace
            onUploaded={onRefresh}
          />
        </>
      )}
    </Panel>
  );
}
