"use client";

import * as React from "react";
import { Flag } from "lucide-react";

/**
 * Live mini bracket that draws its confirmed winner chalk line once on load (`06 §Screens`, `07 §Motion`).
 */
export function MiniBracketHero() {
  const [drawn, setDrawn] = React.useState(false);

  React.useEffect(() => {
    const id = window.setTimeout(() => setDrawn(true), 80);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div
      aria-label="Illustration of Umpra advancing a verified match winner across the bracket"
      className="min-w-0 rounded-[var(--radius-panel)] border border-line bg-paper p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 type-small font-medium text-ink">
          <Flag className="h-4 w-4 text-pitch" strokeWidth={1.75} />
          <span>Both screenshots agree. Kemi won 3-1.</span>
        </div>
        <span className="rounded-full bg-pitch-tint px-2.5 py-0.5 type-caption text-pitch-dark">
          Final confirmed
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox="0 0 540 164"
          className="h-[154px] w-full min-w-[400px]"
          role="img"
          aria-label="Semi-final matches connecting into the final match"
        >
          {/* Base connector lines in line-strong */}
          <path
            d="M 164 42 H 204 V 82 H 236"
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth="2"
          />
          <path
            d="M 164 124 H 204 V 82 H 236"
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth="2"
          />
          <path
            d="M 396 82 H 424"
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth="2"
          />

          {/* Animated winner chalk line in pitch */}
          <path
            d="M 164 42 H 204 V 82 H 236"
            fill="none"
            stroke="var(--color-pitch)"
            strokeWidth="2.5"
            strokeDasharray="160"
            strokeDashoffset={drawn ? "0" : "160"}
            style={{
              transition:
                "stroke-dashoffset var(--dur-draw) var(--ease-out)",
            }}
          />
          <path
            d="M 396 82 H 424"
            fill="none"
            stroke="var(--color-pitch)"
            strokeWidth="2.5"
            strokeDasharray="40"
            strokeDashoffset={drawn ? "0" : "40"}
            style={{
              transition:
                "stroke-dashoffset var(--dur-draw) var(--ease-out) 160ms",
            }}
          />

          {/* Semi-final 1 */}
          <g transform="translate(4, 10)">
            <rect
              width="160"
              height="64"
              rx="4"
              fill="var(--color-paper)"
              stroke="var(--color-line)"
            />
            <rect width="3" height="32" rx="1" fill="var(--color-pitch)" />
            <line
              x1="0"
              y1="32"
              x2="160"
              y2="32"
              stroke="var(--color-line)"
            />
            <text
              x="12"
              y="21"
              fill="var(--color-ink)"
              fontSize="13"
              fontWeight="650"
            >
              Kemi
            </text>
            <text
              x="146"
              y="21"
              textAnchor="end"
              fill="var(--color-pitch)"
              fontSize="13"
              fontWeight="700"
            >
              3
            </text>
            <text x="12" y="53" fill="var(--color-muted)" fontSize="13">
              Sola
            </text>
            <text
              x="146"
              y="53"
              textAnchor="end"
              fill="var(--color-muted)"
              fontSize="13"
            >
              1
            </text>
          </g>

          {/* Semi-final 2 */}
          <g transform="translate(4, 92)">
            <rect
              width="160"
              height="64"
              rx="4"
              fill="var(--color-paper)"
              stroke="var(--color-line)"
            />
            <rect width="3" height="32" rx="1" fill="var(--color-pitch)" />
            <line
              x1="0"
              y1="32"
              x2="160"
              y2="32"
              stroke="var(--color-line)"
            />
            <text
              x="12"
              y="21"
              fill="var(--color-ink)"
              fontSize="13"
              fontWeight="650"
            >
              Tunde
            </text>
            <text
              x="146"
              y="21"
              textAnchor="end"
              fill="var(--color-pitch)"
              fontSize="13"
              fontWeight="700"
            >
              2
            </text>
            <text x="12" y="53" fill="var(--color-muted)" fontSize="13">
              Dami
            </text>
            <text
              x="146"
              y="53"
              textAnchor="end"
              fill="var(--color-muted)"
              fontSize="13"
            >
              0
            </text>
          </g>

          {/* Final */}
          <g transform="translate(236, 50)">
            <rect
              width="160"
              height="64"
              rx="4"
              fill="var(--color-paper)"
              stroke="var(--color-pitch)"
            />
            <rect width="3" height="32" rx="1" fill="var(--color-pitch)" />
            <line
              x1="0"
              y1="32"
              x2="160"
              y2="32"
              stroke="var(--color-line)"
            />
            <text
              x="12"
              y="21"
              fill="var(--color-ink)"
              fontSize="13"
              fontWeight="650"
            >
              Kemi
            </text>
            <text
              x="146"
              y="21"
              textAnchor="end"
              fill="var(--color-pitch)"
              fontSize="13"
              fontWeight="700"
            >
              2
            </text>
            <text x="12" y="53" fill="var(--color-muted)" fontSize="13">
              Tunde
            </text>
            <text
              x="146"
              y="53"
              textAnchor="end"
              fill="var(--color-muted)"
              fontSize="13"
            >
              1
            </text>
          </g>

          {/* Payout Plate Badge */}
          <g transform="translate(424, 54)">
            <rect
              width="110"
              height="56"
              rx="6"
              fill="var(--color-ink)"
            />
            <rect width="110" height="3" rx="1" fill="var(--color-card-yellow)" />
            <text
              x="12"
              y="23"
              fill="var(--color-chalk)"
              fontSize="11"
            >
              1st · Kemi
            </text>
            <text
              x="12"
              y="43"
              fill="var(--color-card-yellow)"
              fontSize="15"
              fontWeight="700"
            >
              $28.00
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}
