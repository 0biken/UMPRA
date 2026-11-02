import * as React from "react";
import { Flag, User } from "lucide-react";

export interface ActivityLogItem {
  id: number;
  tournamentId: string | null;
  actorType: "agent" | "user" | "system" | "paypal";
  actorId: string | null;
  action: string;
  sentence: string;
  createdAt: string | Date;
}

function formatActivityTime(ts: string | Date): string {
  const date = typeof ts === "string" ? new Date(ts) : ts;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ActivityLog({ items }: { items: ActivityLogItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-[var(--radius-panel)] border border-line bg-paper p-6 text-center">
        <p className="type-body text-muted">
          Nothing yet. Umpra will log every action here.
        </p>
      </div>
    );
  }

  return (
    <div
      role="log"
      aria-label="Officials' report activity feed"
      className="divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-paper overflow-hidden"
    >
      {items.map((item) => {
        const isDispute = item.action === "dispute.opened";
        const isAgent = item.actorType === "agent" || item.actorType === "paypal";

        return (
          <div
            key={item.id}
            className={`flex items-start gap-3 px-4 py-3 ${
              isDispute ? "bg-red-tint text-red-ink" : "bg-paper text-ink"
            }`}
          >
            <span className="mt-0.5 shrink-0">
              {isAgent ? (
                <Flag
                  className={`h-4 w-4 ${
                    isDispute ? "text-red-ink" : "text-pitch"
                  }`}
                  strokeWidth={1.75}
                  aria-label="Umpra agent action"
                />
              ) : (
                <User
                  className={`h-4 w-4 ${
                    isDispute ? "text-red-ink" : "text-ink-2"
                  }`}
                  strokeWidth={1.75}
                  aria-label="User action"
                />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p
                className={`type-small ${
                  isDispute
                    ? "font-medium text-red-ink"
                    : isAgent
                      ? "text-ink"
                      : "text-ink-2"
                }`}
              >
                {item.sentence}
              </p>
            </div>

            <time
              dateTime={
                typeof item.createdAt === "string"
                  ? item.createdAt
                  : item.createdAt.toISOString()
              }
              className={`shrink-0 type-caption tabular-nums ${
                isDispute ? "text-red-ink" : "text-muted"
              }`}
            >
              {formatActivityTime(item.createdAt)}
            </time>
          </div>
        );
      })}
    </div>
  );
}
