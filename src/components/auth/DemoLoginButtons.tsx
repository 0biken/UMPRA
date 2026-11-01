"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/banner";
import type { UserRole } from "@/server/db/schema";

export function DemoLoginButtons() {
  const router = useRouter();
  const [loadingRole, setLoadingRole] = React.useState<UserRole | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleDemoLogin(role: UserRole) {
    setError(null);
    setLoadingRole(role);
    try {
      const res = await fetch("/api/auth/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Demo sign-in failed.");
        return;
      }
      router.push(role === "host" ? "/host" : "/play");
      router.refresh();
    } catch {
      setError("Network error starting demo session.");
    } finally {
      setLoadingRole(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && <Banner variant="problem">{error}</Banner>}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          loading={loadingRole === "host"}
          disabled={loadingRole !== null && loadingRole !== "host"}
          onClick={() => handleDemoLogin("host")}
        >
          Try as host
        </Button>
        <Button
          variant="secondary"
          loading={loadingRole === "player"}
          disabled={loadingRole !== null && loadingRole !== "player"}
          onClick={() => handleDemoLogin("player")}
        >
          Try as player
        </Button>
      </div>
    </div>
  );
}
