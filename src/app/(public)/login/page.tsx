"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Flag } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Sign in failed. Check your details.");
        return;
      }
      const role = data?.user?.role;
      const destination =
        nextPath && nextPath.startsWith("/")
          ? nextPath
          : role === "host"
            ? "/host"
            : "/play";
      router.push(destination);
      router.refresh();
    } catch {
      setError("Network error while signing in. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-8 sm:py-12 space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-2 type-h3 text-ink"
        >
          <Flag className="h-5 w-5 text-pitch" strokeWidth={1.75} />
          <span>Umpra</span>
        </Link>
      </div>

      <Panel className="space-y-5">
        <div className="space-y-1">
          <h1 className="type-h1">Sign in</h1>
          <p className="type-small text-muted">
            Enter your account details to manage or play in tournaments.
          </p>
        </div>

        {error && <Banner variant="problem">{error}</Banner>}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
          />
          <Button
            type="submit"
            variant="primary"
            loading={loading}
            className="w-full"
          >
            Sign in
          </Button>
        </form>

        <p className="type-small text-muted text-center pt-2 border-t border-line">
          Need an account?{" "}
          <Link
            href={
              nextPath
                ? `/register?next=${encodeURIComponent(nextPath)}`
                : "/register"
            }
            className="font-medium text-pitch hover:underline"
          >
            Register
          </Link>
        </p>
      </Panel>
    </main>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense
      fallback={
        <main className="mx-auto max-w-md px-4 py-8">
          <Panel>Loading sign-in form...</Panel>
        </main>
      }
    >
      <LoginForm />
    </React.Suspense>
  );
}
