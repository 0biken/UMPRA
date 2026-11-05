import { Button } from "@/components/ui/button";
import { Input, SelectField, Textarea } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { StatePill, type PillState } from "@/components/tournament/StatePill";
import { PrizePlate } from "@/components/tournament/PrizePlate";

const COLOR_SWATCHES = [
  { name: "chalk", hex: "#F2F5F1", bg: "bg-chalk", text: "text-ink" },
  { name: "paper", hex: "#FFFFFF", bg: "bg-paper", text: "text-ink" },
  { name: "ink", hex: "#0F231E", bg: "bg-ink", text: "text-chalk" },
  { name: "ink-2", hex: "#2B433B", bg: "bg-ink-2", text: "text-chalk" },
  { name: "muted", hex: "#5B6F67", bg: "bg-muted", text: "text-chalk" },
  { name: "line", hex: "#D9E1DB", bg: "bg-line", text: "text-ink" },
  { name: "line-strong", hex: "#B7C4BB", bg: "bg-line-strong", text: "text-ink" },
  { name: "pitch", hex: "#17734A", bg: "bg-pitch", text: "text-paper" },
  { name: "pitch-dark", hex: "#0F5636", bg: "bg-pitch-dark", text: "text-paper" },
  { name: "pitch-tint", hex: "#E1F0E7", bg: "bg-pitch-tint", text: "text-ink" },
  { name: "card-yellow", hex: "#F0BE1F", bg: "bg-card-yellow", text: "text-ink" },
  { name: "yellow-tint", hex: "#FCF3CF", bg: "bg-yellow-tint", text: "text-yellow-ink" },
  { name: "yellow-ink", hex: "#6B4E00", bg: "bg-yellow-ink", text: "text-paper" },
  { name: "card-red", hex: "#CC3B33", bg: "bg-card-red", text: "text-paper" },
  { name: "red-tint", hex: "#FBE5E3", bg: "bg-red-tint", text: "text-red-ink" },
  { name: "red-ink", hex: "#8E2620", bg: "bg-red-ink", text: "text-paper" },
];

const ALL_STATES: PillState[] = [
  "draft",
  "open",
  "locked",
  "in_progress",
  "results_pending",
  "confirmed",
  "paid",
  "cancelled",
  "refunded",
  "disputed",
];

export default function StyleguidePage() {
  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <header className="space-y-1">
        <h1 className="type-h1">Umpra design system styleguide</h1>
        <p className="type-body text-muted max-w-[65ch]">
          Referee kit and pitch palette (`07-DESIGN-SYSTEM.md`). Designed at 360px mobile-first with zero horizontal overflow.
        </p>
      </header>

      <Panel className="space-y-4">
        <h2 className="type-h2">Colour tokens</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {COLOR_SWATCHES.map((s) => (
            <div
              key={s.name}
              className={`rounded-[var(--radius-control)] border border-line p-3 ${s.bg} ${s.text}`}
            >
              <div className="type-small font-semibold">{s.name}</div>
              <div className="type-caption font-mono opacity-85">{s.hex}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="space-y-4">
        <h2 className="type-h2">Typography scale</h2>
        <div className="space-y-3">
          <div>
            <span className="type-caption text-muted">display (44/48 desktop, 34/38 mobile, Bricolage 700)</span>
            <div className="type-display tabular-nums">$40.00 prize pool</div>
          </div>
          <div>
            <span className="type-caption text-muted">h1 (30/36, Bricolage 650)</span>
            <div className="type-h1">Lagos Sunday Knockout</div>
          </div>
          <div>
            <span className="type-caption text-muted">h2 (22/28, Bricolage 600)</span>
            <div className="type-h2">Quarterfinals</div>
          </div>
          <div>
            <span className="type-caption text-muted">h3 (18/24, Public Sans 650)</span>
            <div className="type-h3">Match result verification</div>
          </div>
          <div>
            <span className="type-caption text-muted">body (16/24, Public Sans 400, max 65ch)</span>
            <p className="type-body max-w-[65ch]">
              Both screenshots agree. Kemi won 3-1 and moves to the semifinals.
            </p>
          </div>
          <div>
            <span className="type-caption text-muted">small (14/20) and caption (12.5/16)</span>
            <div className="type-small">Entry fee $5.00 · 8 players single elimination</div>
            <div className="type-caption text-muted">14:32 UTC · Batch ID: <span className="font-mono">payout-9a8f1b</span></div>
          </div>
        </div>
      </Panel>

      <Panel className="space-y-4">
        <h2 className="type-h2">State pills</h2>
        <div className="flex flex-wrap gap-2">
          {ALL_STATES.map((st) => (
            <StatePill key={st} state={st} />
          ))}
        </div>
      </Panel>

      <Panel className="space-y-4">
        <h2 className="type-h2">Buttons</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Join for $5</Button>
          <Button variant="secondary">Go back</Button>
          <Button variant="danger">Cancel tournament</Button>
          <Button variant="ghost">Log out</Button>
          <Button variant="primary" size="compact">
            Compact action
          </Button>
          <Button variant="primary" loading>
            Confirm payout
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </Panel>

      <Panel className="space-y-4">
        <h2 className="type-h2">Form inputs</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Gamertag"
            placeholder="e.g. KemiFC"
            helperText="The exact name shown on your post-match scoreboard."
          />
          <Input
            label="PayPal sandbox email"
            defaultValue="not-an-email"
            error="Enter a valid PayPal sandbox personal account email."
          />
          <SelectField label="Role" defaultValue="player">
            <option value="player">Player: join and compete</option>
            <option value="host">Host: run tournaments</option>
          </SelectField>
          <Textarea
            label="Describe your tournament"
            placeholder="8-player football knockout, $5 entry, winner 70%, runner-up 30%"
          />
        </div>
      </Panel>

      <div className="space-y-3">
        <h2 className="type-h2">Prize plate</h2>
        <PrizePlate
          collectedCents={3000}
          projectedPoolCents={4000}
          paidCount={6}
          totalSlots={8}
        />
      </div>

      <Panel className="space-y-4">
        <h2 className="type-h2">Banners, empty state, and skeletons</h2>
        <div className="space-y-3">
          <Banner variant="info">
            Both screenshots agree. Kemi won 3-1.
          </Banner>
          <Banner
            variant="attention"
            action={
              <Button variant="secondary" size="compact">
                Review payout
              </Button>
            }
          >
            Final confirmed. Review the payout.
          </Banner>
          <Banner
            variant="problem"
            action={
              <Button variant="danger" size="compact">
                Resolve dispute
              </Button>
            }
          >
            1 match needs your decision.
          </Banner>
          <EmptyState
            message="No tournaments yet. Create your first one."
            action={<Button variant="primary">New tournament</Button>}
          />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
      </Panel>

      <div className="space-y-3">
        <h2 className="type-h2">Lifecycle stepper</h2>
        <Stepper />
      </div>
    </main>
  );
}
