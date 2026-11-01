import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileEdit,
  Flag,
  Lock,
  Play,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type PillState =
  | "draft"
  | "open"
  | "locked"
  | "in_progress"
  | "results_pending"
  | "confirmed"
  | "paid"
  | "cancelled"
  | "refunded"
  | "disputed";

const PILL_CONFIG: Record<
  PillState,
  { label: string; classes: string; Icon: typeof Flag }
> = {
  draft: {
    label: "Draft",
    classes: "bg-line text-ink-2 border-line-strong",
    Icon: FileEdit,
  },
  open: {
    label: "Open for players",
    classes: "bg-pitch-tint text-pitch-dark border-pitch/30",
    Icon: Play,
  },
  locked: {
    label: "Full",
    classes: "bg-pitch-tint text-pitch-dark border-pitch/30",
    Icon: Lock,
  },
  in_progress: {
    label: "In play",
    classes: "bg-pitch-tint text-pitch-dark border-pitch/30",
    Icon: Flag,
  },
  results_pending: {
    label: "Final being checked",
    classes: "bg-yellow-tint text-yellow-ink border-card-yellow/60",
    Icon: Clock,
  },
  confirmed: {
    label: "Ready to pay out",
    classes: "bg-yellow-tint text-yellow-ink border-card-yellow/60",
    Icon: ShieldCheck,
  },
  paid: {
    label: "Paid out",
    classes: "bg-ink text-chalk border-ink",
    Icon: CheckCircle2,
  },
  cancelled: {
    label: "Cancelled",
    classes: "bg-line text-ink-2 border-line-strong",
    Icon: XCircle,
  },
  refunded: {
    label: "Refunded",
    classes: "bg-line text-ink-2 border-line-strong",
    Icon: RotateCcw,
  },
  disputed: {
    label: "Needs host",
    classes: "bg-red-tint text-red-ink border-card-red/50",
    Icon: AlertCircle,
  },
};

export interface StatePillProps extends React.HTMLAttributes<HTMLSpanElement> {
  state: PillState;
}

export function StatePill({ state, className, ...props }: StatePillProps) {
  const config = PILL_CONFIG[state] ?? PILL_CONFIG.draft;
  const { Icon } = config;
  return (
    <span
      className={cn(
        "inline-flex h-[28px] items-center gap-1.5 rounded-full border px-2.5 type-caption font-medium whitespace-nowrap",
        config.classes,
        className
      )}
      {...props}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <span>{config.label}</span>
    </span>
  );
}
