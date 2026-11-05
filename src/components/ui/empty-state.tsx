import * as React from "react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({
  message,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start sm:items-center justify-center gap-3 rounded-[var(--radius-panel)] border border-line bg-paper p-6 text-left sm:text-center",
        className
      )}
      {...props}
    >
      <p className="type-body text-muted">{message}</p>
      {action && <div>{action}</div>}
    </div>
  );
}
