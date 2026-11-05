"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Banner } from "@/components/ui/banner";
import { useToast } from "@/components/ui/toast";
import { formatUsd } from "@/lib/money";
import type { PayoutSplitBps } from "@/lib/tournament-view";

export function CreateTournamentFlow() {
  const router = useRouter();
  const { pushToast } = useToast();

  const [activeTab, setActiveTab] = React.useState<"describe" | "form">(
    "form"
  );
  const [prompt, setPrompt] = React.useState(
    "8-player knockout, $5 entry, winner 70%, runner-up 30%"
  );
  const [parsing, setParsing] = React.useState(false);
  const [parseProblems, setParseProblems] = React.useState<string[]>([]);
  const [hasParsed, setHasParsed] = React.useState(false);

  // Form fields (populated by Parse or edited directly)
  const [title, setTitle] = React.useState("Friday Night Knockout");
  const [game, setGame] = React.useState("Spot Kick Club");
  const [entryFeeUsd, setEntryFeeUsd] = React.useState("5");
  const [winnerPercent, setWinnerPercent] = React.useState("70");
  const [runnerUpPercent, setRunnerUpPercent] = React.useState("30");

  /** Which button is working: "open" or "draft". Only that button spins. */
  const [submitting, setSubmitting] = React.useState<"open" | "draft" | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  async function handleParse(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setParsing(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/tournaments/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data?.error?.message ?? "Could not parse description.");
        return;
      }

      setHasParsed(true);
      setParseProblems(data.problems ?? []);
      if (data.preview) {
        if (data.preview.title) setTitle(data.preview.title);
        if (data.preview.game) setGame(data.preview.game);
        if (data.preview.entryFeeUsd !== null && data.preview.entryFeeUsd !== undefined) {
          setEntryFeeUsd(String(data.preview.entryFeeUsd));
        }
        if (data.preview.winnerPercent !== null && data.preview.winnerPercent !== undefined) {
          setWinnerPercent(String(data.preview.winnerPercent));
        }
        if (
          data.preview.runnerUpPercent !== null &&
          data.preview.runnerUpPercent !== undefined
        ) {
          setRunnerUpPercent(String(data.preview.runnerUpPercent));
        }
      }
    } catch {
      setSubmitError("Network error while parsing description. Try again.");
    } finally {
      setParsing(false);
    }
  }

  // Compute deterministic preview numbers
  const feeNum = Number(entryFeeUsd);
  const feeValid = Number.isFinite(feeNum) && feeNum >= 1 && feeNum <= 20;
  const entryFeeCents = feeValid ? Math.round(feeNum * 100) : 0;
  const projectedPoolCents = entryFeeCents * 8;

  const winPctNum = Number(winnerPercent);
  const runPctNum = Number(runnerUpPercent || "0");
  const splitValid =
    Number.isFinite(winPctNum) &&
    Number.isFinite(runPctNum) &&
    winPctNum > 0 &&
    runPctNum >= 0 &&
    Math.round((winPctNum + runPctNum) * 100) === 10000;

  const payoutSplitBps: PayoutSplitBps = React.useMemo(() => {
    if (!splitValid) return { "1": 7000, "2": 3000 };
    const split: PayoutSplitBps = { "1": Math.round(winPctNum * 100) };
    if (runPctNum > 0) {
      split["2"] = Math.round(runPctNum * 100);
    }
    return split;
  }, [splitValid, winPctNum, runPctNum]);

  const [previewPayouts, setPreviewPayouts] = React.useState<Array<{ place: number; bps: number; amountCents: number }>>([]);
  React.useEffect(() => {
    setPreviewPayouts([]);
    if (!feeValid || !splitValid) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/tournaments/preview", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ title, game, entryFeeCents, payoutSplit: payoutSplitBps }) });
        if (res.ok) setPreviewPayouts((await res.json()).payouts);
      } catch { /* The form remains editable; no financial state was changed. */ }
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [title, game, feeValid, splitValid, entryFeeCents, payoutSplitBps]);

  async function handleCreate(openImmediately: boolean) {
    setSubmitting(openImmediately ? "open" : "draft");
    setSubmitError(null);
    try {
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          game,
          format: "single_elimination",
          slots: 8,
          entryFeeCents: Math.round(Number(entryFeeUsd) * 100),
          currency: "USD",
          payoutSplit: payoutSplitBps,
          openImmediately,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(
          data?.error?.message ?? "Could not create tournament. Check the fields and try again."
        );
        return;
      }

      pushToast(
        openImmediately ? "Registration opened" : "Tournament draft saved",
        "info"
      );
      router.push(`/t/${data.tournament.id}`);
      router.refresh();
    } catch {
      setSubmitError("Network error while creating tournament. Try again.");
    } finally {
      setSubmitting(null);
    }
  }

  // Say why the create buttons are off instead of leaving them silently disabled.
  const blockedReason =
    title.trim().length < 3
      ? "Add a tournament title of at least 3 characters."
      : !feeValid
        ? "Set an entry fee between $1 and $20."
        : !splitValid
          ? "Make 1st and 2nd place add up to 100%."
          : null;

  const modes: Array<{ key: "describe" | "form"; label: string }> = [
    { key: "describe", label: "Describe in plain words" },
    { key: "form", label: "Fill the form" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-start">
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Tournament setup mode"
          className="inline-flex max-w-full rounded-[var(--radius-control)] border border-line bg-paper p-1"
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            const next = activeTab === "describe" ? "form" : "describe";
            setActiveTab(next);
            document.getElementById(`setup-tab-${next}`)?.focus();
          }}
        >
          {modes.map((mode) => (
            <button
              key={mode.key}
              id={`setup-tab-${mode.key}`}
              type="button"
              role="tab"
              aria-selected={activeTab === mode.key}
              tabIndex={activeTab === mode.key ? 0 : -1}
              onClick={() => setActiveTab(mode.key)}
              className={`min-h-11 rounded-[var(--radius-field)] px-3.5 type-small font-medium transition-colors duration-[var(--dur-fast)] ${
                activeTab === mode.key
                  ? "bg-pitch text-paper"
                  : "text-ink-2 hover:bg-chalk"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {activeTab === "describe" && (
          <Panel className="space-y-4">
            <form onSubmit={handleParse} className="space-y-3">
              <Textarea
                label="Describe your tournament"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                helperText='Example: "8-player knockout, $5 entry, winner 70%, runner-up 30%"'
              />
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="submit"
                  variant="secondary"
                  loading={parsing}
                >
                  Parse description
                </Button>
                {hasParsed && parseProblems.length === 0 && (
                  <span className="type-caption text-pitch">
                    Parsed into the fields below.
                  </span>
                )}
              </div>
            </form>

            {parseProblems.length > 0 && (
              <Banner variant="attention">
                <div className="space-y-1">
                  <div className="font-semibold">
                    Adjust these details before opening registration:
                  </div>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {parseProblems.map((p, idx) => (
                      <li key={idx}>{p}</li>
                    ))}
                  </ul>
                </div>
              </Banner>
            )}
          </Panel>
        )}

        <Panel className="space-y-4">
          <h2 className="type-h3">Tournament details</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Tournament title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              helperText="Shown on the bracket and PayPal description"
              required
            />
            <Input
              label="Game name"
              value={game}
              onChange={(e) => setGame(e.target.value)}
              helperText="Generic game or club title"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              label="Entry fee (USD)"
              type="number"
              min={1}
              max={20}
              step="1"
              value={entryFeeUsd}
              onChange={(e) => setEntryFeeUsd(e.target.value)}
              error={
                !feeValid ? "Entry fee must be between $1 and $20." : undefined
              }
              helperText="$1 to $20 per player"
            />
            <Input
              label="1st place (%)"
              type="number"
              min={1}
              max={100}
              step="1"
              value={winnerPercent}
              onChange={(e) => {
                const v = e.target.value;
                setWinnerPercent(v);
                const num = Number(v);
                if (Number.isFinite(num) && num >= 0 && num <= 100) {
                  setRunnerUpPercent(String(100 - num));
                }
              }}
              helperText="Champion share"
            />
            <Input
              label="2nd place (%)"
              type="number"
              min={0}
              max={99}
              step="1"
              value={runnerUpPercent}
              onChange={(e) => setRunnerUpPercent(e.target.value)}
              error={
                !splitValid ? "1st + 2nd place must equal 100%." : undefined
              }
              helperText="Runner-up share (0 for winner takes all)"
            />
          </div>
        </Panel>
      </div>

      {/* Review card */}
      <Panel className="space-y-4 border-line-strong">
        <div className="space-y-1">
          <h2 className="type-h2">Review terms</h2>
          <p className="type-small text-muted">
            Terms lock once you open registration.
          </p>
        </div>

        <dl className="divide-y divide-line type-small">
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-muted">Format</dt>
            <dd className="font-medium text-ink">
              8 players, single elimination
            </dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-muted">Entry fee</dt>
            <dd className="font-medium tabular-nums text-ink">
              {feeValid ? formatUsd(entryFeeCents) : "-"}
            </dd>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <dt className="text-muted">Projected prize pool (8 paid)</dt>
            <dd className="font-semibold tabular-nums text-ink">
              {feeValid ? formatUsd(projectedPoolCents) : "-"}
            </dd>
          </div>
          {previewPayouts.map((row) => (
            <div
              key={row.place}
              className="flex items-center justify-between py-2.5"
            >
              <dt className="text-muted">
                {row.place === 1 ? "1st place (Champion)" : "2nd place (Runner-up)"}{" "}
                ({(row.bps / 100).toFixed(0)}%)
              </dt>
              <dd className="font-semibold tabular-nums text-pitch">
                {formatUsd(row.amountCents)}
              </dd>
            </div>
          ))}
        </dl>

        {submitError && <Banner variant="problem">{submitError}</Banner>}

        <div className="flex flex-col gap-2.5 pt-2">
          <Button
            variant="primary"
            loading={submitting === "open"}
            disabled={blockedReason !== null || submitting !== null}
            onClick={() => handleCreate(true)}
          >
            Open registration
          </Button>
          <Button
            variant="secondary"
            loading={submitting === "draft"}
            disabled={blockedReason !== null || submitting !== null}
            onClick={() => handleCreate(false)}
          >
            Save draft
          </Button>
          {blockedReason && (
            <p className="type-caption text-muted">{blockedReason}</p>
          )}
        </div>
      </Panel>
    </div>
  );
}
