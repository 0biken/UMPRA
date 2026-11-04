"use client";

import * as React from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Extraction } from "@/lib/vision-types";

export interface CompareSubmissionSide {
  gamertag: string;
  submissionId: string | null;
  imageUrl?: string | null;
  extractionStatus?: string | null;
  extractedJson?: Extraction | null;
  confidence?: number | null;
}

const EXTRACTION_LABELS: Record<string, string> = {
  ok: "Screenshot read",
  pending: "Reading screenshot",
  malformed: "Couldn't read",
  unreadable: "Couldn't read",
};

/** Screenshot with a line-coloured placeholder until the image has loaded. */
function ShotImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = React.useState(false);
  return (
    <div className={loaded ? "bg-chalk" : "animate-pulse bg-line"}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        className="h-48 w-full object-contain"
      />
    </div>
  );
}

export function ScreenshotCompare({
  sideA,
  sideB,
}: {
  sideA: CompareSubmissionSide;
  sideB: CompareSubmissionSide;
}) {
  const [enlarged, setEnlarged] = React.useState<{
    gamertag: string;
    url: string;
  } | null>(null);

  const renderSide = (side: CompareSubmissionSide) => {
    const imgSrc =
      side.imageUrl ??
      (side.submissionId ? `/api/submissions/${side.submissionId}/image` : null);
    const ext = side.extractedJson;

    return (
      <div className="flex flex-col justify-between rounded-[var(--radius-panel)] border border-line bg-paper p-4 space-y-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="type-h3 text-ink">{side.gamertag}</h2>
            <span className="rounded-full border border-line bg-chalk px-2.5 py-0.5 type-caption text-muted">
              {side.submissionId
                ? (EXTRACTION_LABELS[side.extractionStatus ?? ""] ?? "Submitted")
                : "Not submitted"}
            </span>
          </div>

          {imgSrc ? (
            <button
              type="button"
              onClick={() =>
                setEnlarged({ gamertag: side.gamertag, url: imgSrc })
              }
              className="group relative block w-full overflow-hidden rounded-[var(--radius-field)] border border-line bg-chalk text-left"
            >
              <ShotImage src={imgSrc} alt={`${side.gamertag}'s submitted screenshot`} />
              <span className="block border-t border-line bg-paper px-2.5 py-1 type-caption text-muted group-hover:text-ink">
                Tap to enlarge screenshot
              </span>
            </button>
          ) : (
            <div className="flex h-48 items-center justify-center rounded-[var(--radius-field)] border border-dashed border-line-strong bg-chalk p-4 text-center type-small text-muted">
              No screenshot submitted by {side.gamertag}.
            </div>
          )}
        </div>

        <dl className="divide-y divide-line border-t border-line pt-2 type-small">
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-muted">Extracted home</dt>
            <dd className="font-medium tabular-nums text-ink">
              {ext?.home?.name
                ? `${ext.home.name} (${ext.home.score ?? "?"})`
                : "-"}
            </dd>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-muted">Extracted away</dt>
            <dd className="font-medium tabular-nums text-ink">
              {ext?.away?.name
                ? `${ext.away.name} (${ext.away.score ?? "?"})`
                : "-"}
            </dd>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <dt className="text-muted">Vision confidence</dt>
            <dd className="font-medium tabular-nums text-ink">
              {side.confidence !== null && side.confidence !== undefined
                ? `${Math.round(side.confidence * 100)}%`
                : ext?.confidence !== undefined
                  ? `${Math.round(ext.confidence * 100)}%`
                  : "-"}
            </dd>
          </div>
          {ext?.notes && (
            <div className="py-1.5">
              <dt className="type-caption text-muted">Vision notes</dt>
              <dd className="mt-0.5 text-ink-2">{ext.notes}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  };

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {renderSide(sideA)}
        {renderSide(sideB)}
      </div>

      <Dialog
        open={enlarged !== null}
        onClose={() => setEnlarged(null)}
        title={
          enlarged
            ? `${enlarged.gamertag}'s submitted screenshot`
            : "Screenshot"
        }
        actions={
          <Button variant="secondary" onClick={() => setEnlarged(null)}>
            Close
          </Button>
        }
      >
        {enlarged && (
          <div className="pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={enlarged.url}
              alt={`${enlarged.gamertag}'s submitted screenshot`}
              className="max-h-[70vh] w-full rounded-[var(--radius-field)] border border-line bg-chalk object-contain"
            />
          </div>
        )}
      </Dialog>
    </>
  );
}
