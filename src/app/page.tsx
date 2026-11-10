import Link from "next/link";
import { env } from "@/server/env";
import { Panel } from "@/components/ui/panel";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { DemoLoginButtons } from "@/components/auth/DemoLoginButtons";
import { MiniBracketHero } from "@/components/tournament/MiniBracketHero";

// Reads runtime env (demo mode, sandbox buyer); never prerender it at build time.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const isDemo = env.DEMO_MODE;

  return (
    <main className="mx-auto max-w-[1120px] space-y-12 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
        <div className="min-w-0 space-y-5">
          <h1 className="type-display max-w-[26ch] text-balance">
            Umpire the bracket. Pay the winners.
          </h1>
          <p className="type-body max-w-[48ch] text-ink-2">
            Players pay through PayPal. Umpra&apos;s AI reads match screenshots, runs the
            bracket, and pays winners after you confirm.
          </p>

          {isDemo ? (
            <DemoLoginButtons />
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="primary">
                <Link href="/register?role=host">Host a tournament</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link href="/register?role=player">Join as a player</Link>
              </Button>
            </div>
          )}
        </div>

        <MiniBracketHero />
      </section>

      <section className="space-y-4">
        <h2 className="type-h2">How a tournament runs</h2>
        <Stepper />
      </section>

      {isDemo && (
        <Panel className="space-y-3 border-card-yellow bg-yellow-tint">
          <h2 className="type-h3 text-yellow-ink">Sandbox payments: use this test buyer</h2>
          <p className="type-small max-w-[65ch] text-yellow-ink">
            The demo buttons above sign you in as a ready-made host or player. When you pay an
            entry fee, sign in to the PayPal Sandbox approval screen with a sandbox{" "}
            <strong>personal</strong> buyer account. Real money is never charged.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[var(--radius-field)] border border-line bg-paper p-3">
              <div className="type-caption text-muted">Sandbox buyer email</div>
              <div className="type-small select-all break-all font-mono text-ink">
                {env.DEMO_BUYER_EMAIL || "Sandbox buyer not configured yet"}
              </div>
            </div>
            <div className="rounded-[var(--radius-field)] border border-line bg-paper p-3">
              <div className="type-caption text-muted">Playing alone</div>
              <div className="type-small text-ink">
                After one sandbox checkout, use <strong>Fill remaining slots with demo players</strong>{" "}
                on the tournament page. Demo players add no money; only captured fees are paid out.
              </div>
            </div>
          </div>
          {env.DEMO_BUYER_PASSWORD && (
            <p className="type-small text-yellow-ink">
              Sandbox buyer password:{" "}
              <span className="select-all font-mono">{env.DEMO_BUYER_PASSWORD}</span>
            </p>
          )}
        </Panel>
      )}
    </main>
  );
}
