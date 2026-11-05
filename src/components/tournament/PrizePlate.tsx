import * as React from "react";
import { formatUsd } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface PrizePlateProps {
  collectedCents: number;
  projectedPoolCents: number;
  /** Filled slots, real and simulated. */
  paidCount: number;
  /** How many of the filled slots are simulated demo players (they add no money). */
  simulatedCount?: number;
  totalSlots?: number;
  className?: string;
}

export function PrizePlate({
  collectedCents,
  projectedPoolCents,
  paidCount,
  simulatedCount = 0,
  totalSlots = 8,
  className,
}: PrizePlateProps) {
  const simulated = Math.min(Math.max(simulatedCount, 0), paidCount);
  const real = paidCount - simulated;
  const slots = Array.from({ length: totalSlots }, (_, idx) =>
    idx < real ? "paid" : idx < paidCount ? "simulated" : "open"
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-panel)] border border-ink bg-ink text-chalk",
        className
      )}
    >
      <div className="h-[3px] w-full bg-card-yellow" aria-hidden="true" />
      <div className="p-4 md:p-6">
        <div className="type-caption text-chalk/80">Prize pool</div>
        <div className="type-display tabular-nums mt-1 text-chalk">
          {formatUsd(collectedCents)}
        </div>
        <p className="type-small text-chalk/85 mt-1">
          Held by Umpra until the host confirms the payout.
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-chalk/15 pt-3">
          <div
            className="flex items-center gap-2"
            role="img"
            aria-label={
              simulated > 0
                ? `${real} paid, ${simulated} simulated demo players, ${totalSlots - paidCount} open`
                : `${paidCount} of ${totalSlots} slots paid`
            }
          >
            {slots.map((kind, i) => (
              <span
                key={i}
                aria-hidden="true"
                className={cn(
                  "inline-block h-3.5 w-3.5 rounded-full border-2 transition-colors duration-[var(--dur-fast)]",
                  kind === "paid" && "border-pitch bg-pitch",
                  kind === "simulated" && "border-pitch bg-transparent",
                  kind === "open" && "border-chalk/40 bg-transparent"
                )}
              />
            ))}
          </div>
          <span className="type-small tabular-nums text-chalk/90">
            {formatUsd(collectedCents, { trimZeroCents: true })} of{" "}
            {formatUsd(projectedPoolCents, { trimZeroCents: true })} collected
          </span>
        </div>
        {simulated > 0 && (
          <p className="type-caption mt-2 text-chalk/80">
            {simulated} of {paidCount} filled slots are simulated demo players and add no money.
          </p>
        )}
      </div>
    </div>
  );
}
