"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";

function WrongRoleContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const required = searchParams.get("required") === "host" ? "host" : "player";
  const current = searchParams.get("current") === "host" ? "host" : "player";
  const next = searchParams.get("next") ?? (required === "host" ? "/host" : "/play");
  const [loading, setLoading] = React.useState(false);

  async function handleLogoutAndSwitch(targetPath: string) {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push(targetPath);
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10 space-y-6">
      <Panel className="space-y-4">
        <h1 className="type-h1">Role switch needed</h1>
        <Banner variant="attention">
          This page requires a <strong>{required}</strong> account. You are signed in as a{" "}
          <strong>{current}</strong>.
        </Banner>
        <p className="type-body text-muted">
          In Umpra, each account has a single role so hosts cannot enter their own prize pools. Sign out to switch accounts or register a {required} account.
        </p>
        <div className="flex flex-col gap-3 pt-2">
          <Button
            variant="primary"
            loading={loading}
            onClick={() =>
              handleLogoutAndSwitch(
                `/login?next=${encodeURIComponent(next)}`
              )
            }
          >
            Log out and sign in as {required}
          </Button>
          <Button
            variant="secondary"
            loading={loading}
            onClick={() =>
              handleLogoutAndSwitch(
                `/register?role=${required}&next=${encodeURIComponent(next)}`
              )
            }
          >
            Register a new {required} account
          </Button>
          <Link
            href={current === "host" ? "/host" : "/play"}
            className="text-center type-small font-medium text-pitch hover:underline py-2"
          >
            Back to {current} home
          </Link>
        </div>
      </Panel>
    </main>
  );
}

export default function WrongRolePage() {
  return (
    <React.Suspense
      fallback={
        <main className="mx-auto max-w-md px-4 py-10">
          <Panel>Loading...</Panel>
        </main>
      }
    >
      <WrongRoleContent />
    </React.Suspense>
  );
}
