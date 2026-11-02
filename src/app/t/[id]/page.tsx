import * as React from "react";
import { env } from "@/server/env";
import { TournamentViewClient } from "@/components/tournament/TournamentViewClient";

export default async function PublicTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <React.Suspense fallback={<div className="p-6">Loading tournament...</div>}>
      <TournamentViewClient tournamentId={id} demoMode={env.DEMO_MODE} />
    </React.Suspense>
  );
}
