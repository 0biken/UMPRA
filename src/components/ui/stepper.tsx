import * as React from "react";
import { cn } from "@/lib/utils";

const DEFAULT_STEPS = [
  { number: 1, title: "Describe", detail: "Set 8 slots, entry fee, and payout split." },
  { number: 2, title: "Pay", detail: "Players join through PayPal sandbox checkout." },
  { number: 3, title: "Play", detail: "Umpra locks the pool and draws the bracket." },
  { number: 4, title: "Umpire", detail: "Players upload screenshots; Umpra verifies scores." },
  { number: 5, title: "Pay out", detail: "Host taps once to release PayPal Payouts." },
];

export function Stepper({ className }: { className?: string }) {
  return (
    <ol
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-5",
        className
      )}
    >
      {DEFAULT_STEPS.map((step) => (
        <li
          key={step.number}
          className="flex flex-row sm:flex-col items-start gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-4"
        >
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pitch text-paper type-small font-semibold tabular-nums">
            {step.number}
          </span>
          <div>
            <div className="type-small font-semibold text-ink">{step.title}</div>
            <p className="type-caption text-muted mt-0.5">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
