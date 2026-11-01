import * as React from "react";
import { formatUsd } from "@/lib/money";
import { cn } from "@/lib/utils";

export interface PrizePlateProps {
  collectedCents: number;
  projectedPoolCents: number;
  paidCount: number;
  totalSlots?: number;
  className?: string;
}

export function PrizePlate({
  collectedCents,
  projectedPoolCents,
  paidCount,
  totalSlots = 8,
  className,
}: PrizePlateProps) {
  const slots = Array.from({ length: totalSlots }, (_, idx) => idx < paidCount);

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
            aria-label={`${paidCount} of ${totalSlots} slots paid`}
          >
            {slots.map((isPaid, i) => (
              <span
                key={i}
                className={cn(
                  "inline-block h-3.5 w-3.5 rounded-full border transition-colors duration-[var(--dur-fast)]",
                  isPaid
                    ? "border-pitch bg-pitch"
                    : "border-chalk/50 bg-transparent"
                )}
              />
            ))}
          </div>
          <span className="type-small tabular-nums text-chalk/90">
            {formatUsd(collectedCents, { trimZeroCents: true })} of{" "}
            {formatUsd(projectedPoolCents, { trimZeroCents: true })} collected
          </span>
        </div>
      </div>
    </div>
  );
}
