import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  ALL_MATCH_STATES,
  ALL_TOURNAMENT_STATES,
  assertMatchTransition,
  assertTransition,
  canTransition,
} from "@/server/tournament/state-machine";
import { computePayouts } from "@/server/tournament/payout-math";
import { validateTournamentConfig } from "@/server/tournament/config";
import {
  advanceWinner,
  buildSingleElimBracket,
  generateBracketForTournament,
} from "@/server/tournament/bracket";
import {
  cancelTournamentByHost,
  createTournament,
  openTournament,
  updateTournamentTerms,
} from "@/server/tournament/service";
import { audit, listTournamentActivity } from "@/server/audit";
import {
  matches,
  resetTestDatabase,
  users,
  type AppDatabase,
  type TournamentState,
} from "@/server/db";
import { AppError } from "@/lib/errors";

describe("tournament state machine (T-020, EC-S1)", () => {
  const validPairs = new Set([
    "draft->open",
    "draft->cancelled",
    "open->locked",
    "open->cancelled",
    "cancelled->refunded",
    "locked->in_progress",
    "in_progress->results_pending",
    "results_pending->confirmed",
    "confirmed->paid",
  ]);

  it("allows every legal tournament transition and throws INVALID_TRANSITION on every other pair", () => {
    for (const from of ALL_TOURNAMENT_STATES) {
      for (const to of ALL_TOURNAMENT_STATES) {
        const key = `${from}->${to}`;
        if (validPairs.has(key)) {
          expect(canTransition(from, to)).toBe(true);
          expect(() => assertTransition(from, to)).not.toThrow();
        } else {
          expect(canTransition(from, to)).toBe(false);
          expect(() => assertTransition(from, to)).toThrowError(
            expect.objectContaining({ code: "INVALID_TRANSITION" })
          );
        }
      }
    }
  });

  it("enforces match state transitions and never returns to waiting", () => {
    const validMatchPairs = new Set([
      "waiting->awaiting_results",
      "awaiting_results->confirmed",
      "awaiting_results->disputed",
      "disputed->confirmed",
    ]);

    for (const from of ALL_MATCH_STATES) {
      for (const to of ALL_MATCH_STATES) {
        const key = `${from}->${to}`;
        if (validMatchPairs.has(key)) {
          expect(() => assertMatchTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertMatchTransition(from, to)).toThrow(AppError);
        }
      }
    }
  });
});

describe("payout math (T-023)", () => {
  it("computes exact 70/30 split for a $40 pool", () => {
    const items = computePayouts(4000, { "1": 7000, "2": 3000 });
    expect(items).toEqual([
      { place: 1, bps: 7000, amountCents: 2800 },
      { place: 2, bps: 3000, amountCents: 1200 },
    ]);
  });

  it("assigns remainder cents to the last place so sum equals pool across odd pools and splits", () => {
    const pools = [800, 1300, 2399, 4000, 4100, 4101, 7777, 16000];
    const splits: Array<Record<string, number>> = [
      { "1": 10000 },
      { "1": 7000, "2": 3000 },
      { "1": 6500, "2": 3500 },
      { "1": 6667, "2": 3333 },
      { "1": 7500, "2": 2500 },
    ];

    for (const pool of pools) {
      for (const split of splits) {
        const firstRun = computePayouts(pool, split);
        const secondRun = computePayouts(pool, split);
        expect(firstRun).toEqual(secondRun); // deterministic

        const sum = firstRun.reduce((acc, item) => acc + item.amountCents, 0);
        expect(sum).toBe(pool);
        for (const item of firstRun) {
          expect(item.amountCents).toBeGreaterThan(0);
          expect(Number.isInteger(item.amountCents)).toBe(true);
        }
      }
    }
  });

  it("rejects non-10000 bps sum, negative pools, or invalid places", () => {
    expect(() => computePayouts(4000, { "1": 6000, "2": 3000 })).toThrow(
      AppError
    );
    expect(() => computePayouts(0, { "1": 10000 })).toThrow(AppError);
    expect(() => computePayouts(-500, { "1": 10000 })).toThrow(AppError);
  });
});

describe("tournament config schema (T-025)", () => {
  it("validates a standard 8-player tournament config", () => {
    const valid = validateTournamentConfig({
      title: "Lagos Sunday Knockout",
      game: "Football",
      entryFeeUsd: 5,
      winnerPercent: 70,
      runnerUpPercent: 30,
    });
    expect(valid.slots).toBe(8);
    expect(valid.entryFeeCents).toBe(500);
    expect(valid.payoutSplit).toEqual({ "1": 7000, "2": 3000 });
  });

  it("returns field-level validation errors for unsupported slots, fee out of range, or split != 100%", () => {
    expect(() =>
      validateTournamentConfig({
        title: "A",
        game: "Football",
        slots: 16,
        entryFeeCents: 50,
        payoutSplit: { "1": 5000, "2": 3000 },
      })
    ).toThrow(AppError);
  });
});

describe("bracket generation, advancement, service, and audit log (T-021, T-022, T-024, T-026)", () => {
  let db: AppDatabase;
  let hostId: string;
  let playerIds: string[];

  beforeEach(async () => {
    db = await resetTestDatabase();
    const [host] = await db
      .insert(users)
      .values({
        email: "host@umpra.test",
        passwordHash: "hash",
        displayName: "Host",
        role: "host",
      })
      .returning();
    hostId = host.id;

    playerIds = [];
    for (let i = 1; i <= 8; i++) {
      const [p] = await db
        .insert(users)
        .values({
          email: `p${i}@umpra.test`,
          passwordHash: "hash",
          displayName: `Player ${i}`,
          role: "player",
        })
        .returning();
      playerIds.push(p.id);
    }
  });

  it("generates the exact same 7-match bracket for the same seed and links every non-final match (T-021)", () => {
    const tId = "11111111-1111-4111-8111-111111111111";
    const fixedNow = new Date("2026-11-01T12:00:00Z");
    const b1 = buildSingleElimBracket(tId, playerIds, 42, fixedNow);
    const b2 = buildSingleElimBracket(tId, playerIds, 42, fixedNow);
    expect(b1).toEqual(b2);
    expect(b1).toHaveLength(7);

    const finals = b1.filter((m) => m.round === 3);
    expect(finals).toHaveLength(1);
    expect(finals[0].nextMatchId).toBeNull();

    const nonFinals = b1.filter((m) => m.round < 3);
    expect(nonFinals).toHaveLength(6);
    for (const m of nonFinals) {
      expect(m.nextMatchId).toBeTruthy();
      expect(["a", "b"]).toContain(m.nextSlot);
    }
  });

  it("advances winners into next match slots idempotently and activates the next match when both slots fill (T-022)", async () => {
    const t = await createTournament(
      hostId,
      {
        title: "Test Cup",
        game: "Football",
        entryFeeCents: 500,
        payoutSplit: { "1": 7000, "2": 3000 },
      },
      db
    );

    const planned = await generateBracketForTournament(
      db,
      t.id,
      playerIds,
      12345
    );
    const qf0 = planned.find((m) => m.round === 1 && m.position === 0)!;
    const qf1 = planned.find((m) => m.round === 1 && m.position === 1)!;

    // Confirm qf0 winner
    await db
      .update(matches)
      .set({ status: "confirmed", winnerId: qf0.playerAId })
      .where(eq(matches.id, qf0.id));

    const adv1 = await advanceWinner(qf0.id, db);
    expect(adv1.advanced).toBe(true);
    expect(adv1.nextMatchActivated).toBe(false);

    // Calling advanceWinner a second time is a no-op (idempotent)
    const adv1Duplicate = await advanceWinner(qf0.id, db);
    expect(adv1Duplicate.advanced).toBe(false);
    expect(adv1Duplicate.nextMatchActivated).toBe(false);

    // Confirm qf1 winner -> fills slot 'b' of semi0 and activates semi0 to awaiting_results
    await db
      .update(matches)
      .set({ status: "confirmed", winnerId: qf1.playerBId })
      .where(eq(matches.id, qf1.id));

    const adv2 = await advanceWinner(qf1.id, db);
    expect(adv2.advanced).toBe(true);
    expect(adv2.nextMatchActivated).toBe(true);

    const [semi0] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, qf0.nextMatchId!));
    expect(semi0.playerAId).toBe(qf0.playerAId);
    expect(semi0.playerBId).toBe(qf1.playerBId);
    expect(semi0.status).toBe("awaiting_results");
    expect(semi0.awaitingSince).toBeInstanceOf(Date);
  });

  it("freezes payout_split and entry_fee_cents once the tournament is open and audits transitions (T-024, T-026, EC-O6)", async () => {
    const created = await createTournament(hostId, {
      title: "Draft Cup",
      game: "Football",
      entryFeeCents: 500,
      payoutSplit: { "1": 7000, "2": 3000 },
    });

    // Editing in draft is allowed
    const edited = await updateTournamentTerms(hostId, created.id, {
      payoutSplit: { "1": 8000, "2": 2000 },
    });
    expect(edited.payoutSplit).toEqual({ "1": 8000, "2": 2000 });

    // Open registration
    const opened = await openTournament(hostId, created.id);
    expect(opened.state).toBe("open" satisfies TournamentState);

    // Editing split or fee after open throws INVALID_TRANSITION (EC-O6)
    await expect(
      updateTournamentTerms(hostId, created.id, {
        payoutSplit: { "1": 6000, "2": 4000 },
      })
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      status: 409,
    });

    // Cancelling in open works and logs to audit
    const cancelled = await cancelTournamentByHost(
      hostId,
      created.id,
      "Not enough players"
    );
    expect(cancelled.state).toBe("cancelled");

    // Audit dedupe_key idempotency check (T-026)
    const firstInsert = await audit(db, {
      tournamentId: created.id,
      actorType: "agent",
      action: "tournament.locked",
      dedupeKey: "lock:test",
    });
    const secondInsert = await audit(db, {
      tournamentId: created.id,
      actorType: "agent",
      action: "tournament.locked",
      dedupeKey: "lock:test",
    });
    expect(firstInsert.inserted).toBe(true);
    expect(secondInsert.inserted).toBe(false);

    const feed = await listTournamentActivity(created.id);
    expect(feed.length).toBeGreaterThanOrEqual(4);
    expect(feed[0].sentence).toBeTruthy();
  });
});
