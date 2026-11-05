"use client";

import * as React from "react";
import { CheckCircle2, AlertTriangle, XCircle, X } from "lucide-react";

export type ToastVariant = "info" | "attention" | "problem";

export interface ToastMessage {
  id: string;
  title: string;
  variant?: ToastVariant;
}

interface ToastContextValue {
  pushToast: (title: string, variant?: ToastVariant) => void;
}

const ToastContext = React.createContext<ToastContextValue>({
  pushToast: () => undefined,
});

export function useToast() {
  return React.useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);

  const pushToast = React.useCallback(
    (title: string, variant: ToastVariant = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, title, variant }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ pushToast }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-4 left-4 right-4 z-50 flex flex-col gap-2 sm:bottom-auto sm:left-auto sm:top-4 sm:right-4 sm:w-full sm:max-w-sm pointer-events-none"
      >
        {toasts.map((t) => {
          const isProblem = t.variant === "problem";
          const isAttention = t.variant === "attention";
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-center justify-between gap-3 rounded-[var(--radius-control)] border px-3.5 py-3 shadow-[var(--shadow-float)] type-small ${
                isProblem
                  ? "border-card-red bg-red-tint text-red-ink"
                  : isAttention
                    ? "border-card-yellow bg-yellow-tint text-yellow-ink"
                    : "border-pitch bg-pitch-tint text-ink"
              }`}
            >
              <div className="flex items-center gap-2.5">
                {isProblem ? (
                  <XCircle className="h-5 w-5 shrink-0 text-card-red" strokeWidth={1.75} />
                ) : isAttention ? (
                  <AlertTriangle
                    className="h-5 w-5 shrink-0 text-yellow-ink"
                    strokeWidth={1.75}
                  />
                ) : (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-pitch" strokeWidth={1.75} />
                )}
                <span className="font-medium">{t.title}</span>
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="rounded-[var(--radius-field)] p-1 hover:bg-black/5"
              >
                <X className="h-4 w-4" strokeWidth={1.75} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
