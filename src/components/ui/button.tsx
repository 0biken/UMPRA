import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "default" | "compact";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Render the single child (for example a Link) with button styling, instead of a nested button. */
  asChild?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-pitch text-paper hover:bg-pitch-dark active:bg-pitch-dark border border-transparent",
  secondary:
    "bg-paper text-ink border border-line-strong hover:bg-chalk active:bg-line",
  danger:
    "bg-card-red text-paper hover:opacity-90 active:opacity-95 border border-transparent",
  ghost:
    "bg-transparent text-ink hover:bg-line/50 active:bg-line border border-transparent",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-[44px] px-4 text-[16px] leading-[24px] font-medium",
  compact: "h-[36px] px-3 text-[14px] leading-[20px] font-medium",
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "default",
      loading = false,
      asChild = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const isDisabled = Boolean(disabled || loading);
    const classes = cn(
      "relative inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] transition-colors duration-[var(--dur-fast)] select-none cursor-pointer",
      variantClasses[variant],
      sizeClasses[size],
      isDisabled && "opacity-50 pointer-events-none cursor-not-allowed",
      className
    );
    if (asChild) {
      return (
        <Slot ref={ref as React.Ref<HTMLElement>} className={classes} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        className={classes}
        {...props}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center gap-2",
            loading && "opacity-0"
          )}
        >
          {children}
        </span>
        {loading && (
          <span
            className="absolute inset-0 flex items-center justify-center"
            aria-hidden="true"
          >
            <Loader2 className="h-5 w-5 animate-spin" strokeWidth={1.75} />
          </span>
        )}
      </button>
    );
  }
);
Button.displayName = "Button";
