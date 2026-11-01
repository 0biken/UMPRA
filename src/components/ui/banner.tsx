import * as React from "react";
import { AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type BannerVariant = "info" | "attention" | "problem";

export interface BannerProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BannerVariant;
  action?: React.ReactNode;
}

const variantConfig: Record<
  BannerVariant,
  { wrapper: string; Icon: typeof CheckCircle2; iconColor: string }
> = {
  info: {
    wrapper: "bg-pitch-tint text-ink border-pitch/30",
    Icon: CheckCircle2,
    iconColor: "text-pitch",
  },
  attention: {
    wrapper: "bg-yellow-tint text-yellow-ink border-card-yellow/50",
    Icon: AlertTriangle,
    iconColor: "text-yellow-ink",
  },
  problem: {
    wrapper: "bg-red-tint text-red-ink border-card-red/40",
    Icon: ShieldAlert,
    iconColor: "text-card-red",
  },
};

export function Banner({
  variant = "info",
  action,
  className,
  children,
  ...props
}: BannerProps) {
  const { wrapper, Icon, iconColor } = variantConfig[variant];
  return (
    <div
      role={variant === "problem" ? "alert" : "status"}
      className={cn(
        "flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-[var(--radius-control)] border px-4 py-3 type-small font-medium",
        wrapper,
        className
      )}
      {...props}
    >
      <div className="flex items-start sm:items-center gap-2.5">
        <Icon className={cn("h-5 w-5 shrink-0 mt-0.5 sm:mt-0", iconColor)} strokeWidth={1.75} />
        <div>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
