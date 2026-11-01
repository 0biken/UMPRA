import * as React from "react";
import { cn } from "@/lib/utils";

export type PanelProps = React.HTMLAttributes<HTMLDivElement>;

export const Panel = React.forwardRef<HTMLDivElement, PanelProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-[var(--radius-panel)] border border-line bg-paper p-4 md:p-6",
        className
      )}
      {...props}
    />
  )
);
Panel.displayName = "Panel";
