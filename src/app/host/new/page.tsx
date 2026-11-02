import Link from "next/link";
import { CreateTournamentFlow } from "@/components/tournament/CreateTournamentFlow";
import { Button } from "@/components/ui/button";

export default function CreateTournamentPage() {
  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="type-h1">New tournament</h1>
          <p className="type-small text-muted">
            Describe your tournament in plain words or fill the form directly.
          </p>
        </div>
        <Button asChild variant="secondary" size="compact">
          <Link href="/host">Back to my tournaments</Link>
        </Button>
      </div>

      <CreateTournamentFlow />
    </main>
  );
}
