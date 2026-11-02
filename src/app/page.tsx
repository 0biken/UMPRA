import Link from "next/link";
import { env } from "@/server/env";
import { Panel } from "@/components/ui/panel";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { DemoLoginButtons } from "@/components/auth/DemoLoginButtons";
import { MiniBracketHero } from "@/components/tournament/MiniBracketHero";

export default function HomePage() {
  const isDemo = env.DEMO_MODE;

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="min-w-0 space-y-5">
          <h1 className="type-display max-w-[22ch]">
            An autonomous tournament umpire that holds the prize pool and pays the winners.
          </h1>
          <p className="type-body text-ink-2 max-w-[65ch]">
            Umpra runs an 8-player knockout tournament end to end: players pay entry fees into PayPal checkout, upload match result screenshots, the AI umpire verifies the scoreline and escalates disputes, and the host taps once to release PayPal Payouts.
          </p>

          {isDemo ? (
            <div className="space-y-2">
              <DemoLoginButtons />
              <p className="type-caption text-muted">
                One-click judge login sets a real session cookie and takes you straight into the host or player flow.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Link href="/register?role=host">
                <Button variant="primary">Host a tournament</Button>
              </Link>
              <Link href="/play">
                <Button variant="secondary">Browse open tournaments</Button>
              </Link>
            </div>
          )}
        </div>

        <MiniBracketHero />
      </section>

      <section className="space-y-3">
        <h2 className="type-h2">Tournament lifecycle</h2>
        <Stepper />
      </section>

      {isDemo && (
        <Panel className="space-y-3 border-card-yellow bg-yellow-tint">
          <h2 className="type-h3 text-yellow-ink">
            Sandbox payments: use this test buyer
          </h2>
          <p className="type-small text-yellow-ink max-w-[65ch]">
            When paying an entry fee on the PayPal Sandbox approval screen, sign in with a PayPal Sandbox <strong>personal</strong> buyer account. Real money is never charged.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--radius-field)] border border-line bg-paper p-3">
              <div className="type-caption text-muted">Sandbox buyer email</div>
              <div className="font-mono type-small text-ink select-all">
                {env.DEMO_BUYER_EMAIL || "Sandbox buyer not configured yet"}
              </div>
            </div>
            <div className="rounded-[var(--radius-field)] border border-line bg-paper p-3">
              <div className="type-caption text-muted">Solo judge mode</div>
              <div className="type-small text-ink">
                On any open tournament, use <strong>Fill remaining slots with demo players</strong> after one sandbox checkout. Demo players add no money; only captured fees are paid out.
              </div>
            </div>
          </div>
          {env.DEMO_BUYER_PASSWORD && <p className="type-small text-yellow-ink">Sandbox buyer password: <span className="font-mono select-all">{env.DEMO_BUYER_PASSWORD}</span></p>}
        </Panel>
      )}
    </main>
  );
}
