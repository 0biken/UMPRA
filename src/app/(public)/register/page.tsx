"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Flag } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/tournament-view";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");
  const initialRole: UserRole =
    searchParams.get("role") === "host" ? "host" : "player";

  const [role, setRole] = React.useState<UserRole>(initialRole);
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>(
    {}
  );
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, displayName, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        const flat = data?.error?.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        if (flat) {
          const mapped: Record<string, string> = {};
          for (const [k, v] of Object.entries(flat)) {
            if (v?.[0]) mapped[k] = v[0];
          }
          setFieldErrors(mapped);
        }
        setError(
          data?.error?.message ?? "Registration failed. Check the fields below."
        );
        return;
      }

      const destination =
        nextPath && nextPath.startsWith("/")
          ? nextPath
          : role === "host"
            ? "/host"
            : "/play";
      router.push(destination);
      router.refresh();
    } catch {
      setError(
        "Network error while creating your account. Check your connection and try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8 sm:py-12 space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-2 type-h3 text-ink"
        >
          <Flag className="h-5 w-5 text-pitch" strokeWidth={1.75} />
          <span>Umpra</span>
        </Link>
      </div>

      <Panel className="space-y-5">
        <div className="space-y-1">
          <h1 className="type-h1">Create account</h1>
          <p className="type-small text-muted">
            Choose your role on Umpra. Each account holds one role.
          </p>
        </div>

        {error && <Banner variant="problem">{error}</Banner>}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <fieldset className="space-y-2">
            <legend className="type-small font-medium text-ink">
              Account role
            </legend>
            <div className="grid grid-cols-1 gap-2.5">
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 transition-colors duration-[var(--dur-fast)]",
                  role === "player"
                    ? "border-pitch bg-pitch-tint/40"
                    : "border-line-strong bg-paper hover:bg-chalk"
                )}
              >
                <input
                  type="radio"
                  name="role"
                  value="player"
                  checked={role === "player"}
                  onChange={() => setRole("player")}
                  className="mt-1 h-4 w-4 accent-pitch"
                />
                <div>
                  <div className="type-small font-semibold text-ink">
                    Player
                  </div>
                  <div className="type-caption text-muted">
                    Pay entry fees, upload match screenshots, and receive prize payouts.
                  </div>
                </div>
              </label>

              <label
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 transition-colors duration-[var(--dur-fast)]",
                  role === "host"
                    ? "border-pitch bg-pitch-tint/40"
                    : "border-line-strong bg-paper hover:bg-chalk"
                )}
              >
                <input
                  type="radio"
                  name="role"
                  value="host"
                  checked={role === "host"}
                  onChange={() => setRole("host")}
                  className="mt-1 h-4 w-4 accent-pitch"
                />
                <div>
                  <div className="type-small font-semibold text-ink">Host</div>
                  <div className="type-caption text-muted">
                    Create tournaments, settle flagged disputes, and confirm winner payouts.
                  </div>
                </div>
              </label>
            </div>
          </fieldset>

          <Input
            label="Display name"
            type="text"
            autoComplete="name"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Kemi Adeyemi"
            error={fieldErrors.displayName}
          />

          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            error={fieldErrors.email}
          />

          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8 to 72 characters"
            helperText="Use at least 8 characters."
            error={fieldErrors.password}
          />

          <Button
            type="submit"
            variant="primary"
            loading={loading}
            className="w-full"
          >
            Create {role} account
          </Button>
        </form>

        <p className="type-small text-muted text-center pt-2 border-t border-line">
          Already have an account?{" "}
          <Link
            href={
              nextPath
                ? `/login?next=${encodeURIComponent(nextPath)}`
                : "/login"
            }
            className="font-medium text-pitch hover:underline"
          >
            Sign in
          </Link>
        </p>
      </Panel>
    </main>
  );
}

export default function RegisterPage() {
  return (
    <React.Suspense
      fallback={
        <main className="mx-auto max-w-md px-4 py-8">
          <Panel>Loading registration form...</Panel>
        </main>
      }
    >
      <RegisterForm />
    </React.Suspense>
  );
}
