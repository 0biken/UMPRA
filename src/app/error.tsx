"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-[640px] px-4 py-12 sm:px-6">
      <Panel className="space-y-4 border-card-red bg-red-tint/40">
        <div className="flex items-center gap-2.5 text-red-ink">
          <AlertTriangle className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          <h1 className="type-h2">Something interrupted this page</h1>
        </div>
        <p className="type-body text-ink-2">
          {error.message ||
            "The page could not finish loading. Refresh or return to the home screen."}
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Button variant="primary" onClick={() => reset()}>
            Try again
          </Button>
          <Link href="/">
            <Button variant="secondary">Back to home</Button>
          </Link>
        </div>
      </Panel>
    </main>
  );
}
