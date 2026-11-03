import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FieldBaseProps {
  label: string;
  helperText?: string;
  error?: string;
  id?: string;
}

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement>,
    FieldBaseProps {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, helperText, error, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const msgId = `${inputId}-msg`;

    return (
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="type-small font-medium text-ink"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={error || helperText ? msgId : undefined}
          className={cn(
            "h-[44px] w-full rounded-[var(--radius-field)] bg-paper px-3 type-body text-ink border border-muted placeholder:text-muted/80 transition-colors duration-[var(--dur-fast)]",
            error && "border-card-red bg-red-tint/20",
            className
          )}
          {...props}
        />
        {error ? (
          <p
            id={msgId}
            role="alert"
            className="inline-flex items-center gap-1.5 type-caption text-red-ink"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-card-red" strokeWidth={1.75} />
            <span>{error}</span>
          </p>
        ) : helperText ? (
          <p id={msgId} className="type-caption text-muted">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);
Input.displayName = "Input";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    FieldBaseProps {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, helperText, error, id, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const msgId = `${inputId}-msg`;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="type-small font-medium text-ink">
          {label}
        </label>
        <textarea
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={error || helperText ? msgId : undefined}
          className={cn(
            "min-h-[96px] w-full rounded-[var(--radius-field)] bg-paper p-3 type-body text-ink border border-muted placeholder:text-muted/80 transition-colors duration-[var(--dur-fast)]",
            error && "border-card-red bg-red-tint/20",
            className
          )}
          {...props}
        />
        {error ? (
          <p
            id={msgId}
            role="alert"
            className="inline-flex items-center gap-1.5 type-caption text-red-ink"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-card-red" strokeWidth={1.75} />
            <span>{error}</span>
          </p>
        ) : helperText ? (
          <p id={msgId} className="type-caption text-muted">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement>,
    FieldBaseProps {}

export const SelectField = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, helperText, error, id, children, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const msgId = `${inputId}-msg`;

    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="type-small font-medium text-ink">
          {label}
        </label>
        <select
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error)}
          aria-describedby={error || helperText ? msgId : undefined}
          className={cn(
            "h-[44px] w-full rounded-[var(--radius-field)] bg-paper px-3 type-body text-ink border border-muted transition-colors duration-[var(--dur-fast)]",
            error && "border-card-red bg-red-tint/20",
            className
          )}
          {...props}
        >
          {children}
        </select>
        {error ? (
          <p
            id={msgId}
            role="alert"
            className="inline-flex items-center gap-1.5 type-caption text-red-ink"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-card-red" strokeWidth={1.75} />
            <span>{error}</span>
          </p>
        ) : helperText ? (
          <p id={msgId} className="type-caption text-muted">
            {helperText}
          </p>
        ) : null}
      </div>
    );
  }
);
SelectField.displayName = "SelectField";
