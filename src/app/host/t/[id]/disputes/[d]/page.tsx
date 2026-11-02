"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Flag } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/ui/banner";
import { StatePill } from "@/components/ui/state-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ScreenshotCompare } from "@/components/tournament/ScreenshotCompare";
import { getDisputeReasonLabel } from "@/lib/dispute-reasons";
import type { Extraction } from "@/lib/vision-types";

interface DisputeMatchView {
  id: string;
  round: number;
  position: number;
  playerAId: string | null;
  playerAGamertag: string | null;
  playerBId: string | null;
  playerBGamertag: string | null;
  status: string;
  submissions: Array<{
    id: string;
    playerId: string;
    gamertag: string;
    extractionStatus: string;
    extractedJson: Extraction | null;
    confidence: number | null;
  }>;
  dispute: {
    id: string;
    reason: string;
    summary: string | null;
    status: "open" | "resolved";
    resolvedWinnerId: string | null;
    resolvedWinnerGamertag: string | null;
    resolutionNote: string | null;
  } | null;
}

export default function ResolveDisputePage() {
  const params = useParams<{ id: string; d: string }>();
  const tournamentId = params.id;
  const disputeId = params.d;
  const router = useRouter();
  const { pushToast } = useToast();

  const [match, setMatch] = React.useState<DisputeMatchView | null>(null);
  const [tournamentTitle, setTournamentTitle] = React.useState("");
  const [note, setNote] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [resolvingFor, setResolvingFor] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [resolvedBanner, setResolvedBanner] = React.useState<string | null>(
    null
  );

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? "Could not load dispute.");
      }
      setTournamentTitle(data.tournament.title);
      const found = (data.matches as DisputeMatchView[]).find(
        (m) => m.dispute?.id === disputeId
      );
      if (!found || !found.dispute) {
        throw new Error("Dispute not found for this tournament.");
      }
      setMatch(found);
      if (found.dispute.status === "resolved") {
        setResolvedBanner(
          `Resolved. Umpra has moved ${found.dispute.resolvedWinnerGamertag ?? "the winner"} to the next round.`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load dispute.");
    } finally {
      setLoading(false);
    }
  }, [tournamentId, disputeId]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleResolve(winnerId: string, winnerTag: string) {
    setResolvingFor(winnerId);
    setError(null);
    try {
      const res = await fetch(`/api/disputes/${disputeId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resolution: winnerId === match?.playerAId ? "winner_a" : "winner_b",
          note: note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Could not resolve dispute.");
        return;
      }

      const msg = `Resolved. Umpra has moved ${winnerTag} to the next round.`;
      setResolvedBanner(msg);
      pushToast(`Ruled for ${winnerTag}`, "info");
      await loadData();
      router.refresh();
    } catch {
      setError("Network error while resolving dispute.");
    } finally {
      setResolvingFor(null);
    }
  }

  if (loading) {
    return (
      <main
        className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-4"
        aria-busy="true"
      >
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
      </main>
    );
  }

  if (error || !match || !match.dispute) {
    return (
      <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-4">
        <Banner variant="problem">{error ?? "Dispute not found."}</Banner>
        <Button asChild variant="secondary">
          <Link href={`/t/${tournamentId}`}>Back to tournament</Link>
        </Button>
      </main>
    );
  }

  const subA = match.submissions.find((s) => s.playerId === match.playerAId);
  const subB = match.submissions.find((s) => s.playerId === match.playerBId);
  const tagA = match.playerAGamertag ?? "Player A";
  const tagB = match.playerBGamertag ?? "Player B";
  const reasonLabel = getDisputeReasonLabel(match.dispute.reason);

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="type-h1">
              Dispute: {tagA} vs {tagB}
            </h1>
            <StatePill
              state={
                match.dispute.status === "open" ? "disputed" : "in_progress"
              }
            />
          </div>
          <p className="type-small text-muted">
            {tournamentTitle} · Round {match.round} · Reason: {reasonLabel}
          </p>
        </div>
        <Button asChild variant="secondary" size="compact">
          <Link href={`/t/${tournamentId}`}>Back to bracket</Link>
        </Button>
      </div>

      {resolvedBanner && <Banner variant="info">{resolvedBanner}</Banner>}

      {/* Agent summary panel */}
      <Panel className="space-y-2 border-card-red bg-red-tint">
        <div className="flex items-center gap-2 type-h3 text-red-ink">
          <Flag className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          <span>Umpra summary · {reasonLabel}</span>
        </div>
        <p className="type-body text-red-ink max-w-[65ch]">
          {match.dispute.summary ??
            "Submitted screenshots did not agree or could not be verified."}
        </p>
      </Panel>

      {/* Side-by-side screenshot comparison */}
      <ScreenshotCompare
        sideA={{
          gamertag: tagA,
          submissionId: subA?.id ?? null,
          extractionStatus: subA?.extractionStatus ?? null,
          extractedJson: subA?.extractedJson ?? null,
          confidence: subA?.confidence ?? null,
        }}
        sideB={{
          gamertag: tagB,
          submissionId: subB?.id ?? null,
          extractionStatus: subB?.extractionStatus ?? null,
          extractedJson: subB?.extractedJson ?? null,
          confidence: subB?.confidence ?? null,
        }}
      />

      {/* Host decision controls */}
      {match.dispute.status === "open" && match.playerAId && match.playerBId && (
        <Panel className="space-y-4 border-line-strong">
          <h2 className="type-h3">Make the official ruling</h2>
          <div className="max-w-lg">
            <Input
              label="Optional ruling note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              helperText="Recorded in the tournament audit log"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              loading={resolvingFor === match.playerAId}
              disabled={resolvingFor !== null}
              onClick={() => handleResolve(match.playerAId!, tagA)}
            >
              {tagA} won
            </Button>
            <Button
              variant="primary"
              loading={resolvingFor === match.playerBId}
              disabled={resolvingFor !== null}
              onClick={() => handleResolve(match.playerBId!, tagB)}
            >
              {tagB} won
            </Button>
          </div>
        </Panel>
      )}
    </main>
  );
}
