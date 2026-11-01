import Link from "next/link";
import { Flag } from "lucide-react";
import { env } from "@/server/env";
import { Panel } from "@/components/ui/panel";
import { Stepper } from "@/components/ui/stepper";
import { Button } from "@/components/ui/button";
import { DemoLoginButtons } from "@/components/auth/DemoLoginButtons";

export default function HomePage() {
  const isDemo = env.DEMO_MODE;

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 space-y-8">
      <header className="flex items-center justify-between border-b border-line pb-4">
        <div className="inline-flex items-center gap-2 type-h3 text-ink">
          <Flag className="h-5 w-5 text-pitch" strokeWidth={1.75} />
          <span>Umpra</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="compact">
              Sign in
            </Button>
          </Link>
          <Link href="/register">
            <Button variant="secondary" size="compact">
              Register
            </Button>
          </Link>
        </nav>
      </header>

      <section className="space-y-5">
        <h1 className="type-display max-w-[22ch]">
          An autonomous tournament umpire that holds the prize pool and pays the winners.
        </h1>
        <p className="type-body text-muted max-w-[65ch]">
          Players pay entry fees into PayPal sandbox checkout, upload match result screenshots, and Umpra verifies the scoreline before the host confirms PayPal Payouts.
        </p>

        {isDemo ? (
          <DemoLoginButtons />
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
      </section>

      <section className="space-y-3">
        <h2 className="type-h2">How Umpra runs a tournament</h2>
        <Stepper />
      </section>

      {isDemo && (
        <Panel className="space-y-2 border-card-yellow/60 bg-yellow-tint/40">
          <h2 className="type-h3 text-yellow-ink">
            Sandbox payments: use this test buyer
          </h2>
          <p className="type-small text-yellow-ink">
            Demo mode is active. Use <strong>Try as host</strong> or{" "}
            <strong>Try as player</strong> above for one-click judge access, or sign into PayPal Sandbox checkout with your personal sandbox buyer account.
          </p>
        </Panel>
      )}
    </main>
  );
}
