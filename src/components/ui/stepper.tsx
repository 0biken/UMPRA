import * as React from "react";
import { cn } from "@/lib/utils";

const DEFAULT_STEPS = [
  { number: 1, title: "Describe", detail: "Set 8 slots, the entry fee, and the payout split." },
  { number: 2, title: "Pay", detail: "Players join through PayPal checkout." },
  { number: 3, title: "Play", detail: "Umpra locks the pool and draws the bracket." },
  { number: 4, title: "Umpire", detail: "Players upload screenshots and Umpra checks the score." },
  { number: 5, title: "Pay out", detail: "You tap once to release the prize money." },
];

/** The tournament lifecycle. Numbering is allowed here because it is a true sequence. */
export function Stepper({ className }: { className?: string }) {
  return (
    <ol
      className={cn(
        "grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-5",
        className
      )}
    >
      {DEFAULT_STEPS.map((step) => (
        <li
          key={step.number}
          className="flex items-start gap-3 sm:flex-col sm:gap-2 sm:border-t-2 sm:border-pitch sm:pt-3"
        >
          <span
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-pitch type-small font-semibold tabular-nums text-paper sm:hidden"
            aria-hidden="true"
          >
            {step.number}
          </span>
          <div>
            <div className="type-small font-semibold text-ink">
              <span className="hidden tabular-nums text-pitch sm:inline">{step.number}. </span>
              {step.title}
            </div>
            <p className="mt-0.5 type-caption text-muted">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
