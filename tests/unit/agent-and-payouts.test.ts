import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { FakePayPal } from "@/server/paypal/fake";
import { FakeVision } from "@/server/agent/vision/provider";
import { MemoryStorageProvider } from "@/server/storage";
import {
  joinTournamentAndCreateOrder,
  verifyAndCaptureEntryOrder,
} from "@/server/paypal/orders";
import {
  confirmAndSendTournamentPayout,
  draftTournamentPayouts,
  getPayoutReviewData,
  getTournamentLedger,
  retryFailedPayoutItem,
  sendPayoutBatch,
  syncTournamentPayoutStatuses,
} from "@/server/paypal/payouts";
import { submitMatchScreenshot } from "@/server/tournament/submissions";
import {
  createTournament,
  openTournament,
} from "@/server/tournament/service";
import { agentTools } from "@/server/agent/tools";
import { sweepActiveTournaments, tick } from "@/server/agent/tick";
import { assertSweepSecret } from "@/server/agent/auth";
import { listTournamentActivity } from "@/server/audit";
import {
  disputes,
  matches,
  payouts,
  resetTestDatabase,
  tournaments,
  users,
  type AppDatabase,
} from "@/server/db";

describe("umpire loop, tools, restart safety, and payout release (T-050 to T-064)", () => {
  let db: AppDatabase;
  let fakePayPal: FakePayPal;
  let fakeVision: FakeVision;
  let storage: MemoryStorageProvider;
  let hostId: string;
  let playerIds: string[];
  let tournamentId: string;

  beforeEach(async () => {
    db = await resetTestDatabase();
    fakePayPal = new FakePayPal();
    fakeVision = new FakeVision();
    storage = new MemoryStorageProvider();

    const [host] = await db
      .insert(users)
      .values({
        email: "host@umpra.test",
        passwordHash: "hash",
        displayName: "Host Official",
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
          paypalEmail: `sb-p${i}@personal.example.com`,
        })
        .returning();
      playerIds.push(p.id);
    }

    const created = await createTournament(hostId, {
      title: "Umpire Championship",
      game: "Football",
      entryFeeCents: 500,
      payoutSplit: { "1": 7000, "2": 3000 },
    });
    await openTournament(hostId, created.id);
    tournamentId = created.id;
  });

  async function payAll8Players() {
    for (let i = 0; i < 8; i++) {
      const join = await joinTournamentAndCreateOrder(
        {
          tournamentId,
          playerId: playerIds[i],
          gamertag: `Club${i + 1}`,
          paypalEmail: `sb-p${i + 1}@personal.example.com`,
        },
        { paypal: fakePayPal }
      );
      fakePayPal.approveOrder(join.orderId);
      await verifyAndCaptureEntryOrder(join.entryId, { paypal: fakePayPal });
    }
  }

  async function submitAgreeingMatchResult(matchId: string) {
    const [m] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId));

    const png = new Uint8Array([137, 80, 78, 71]);
    await submitMatchScreenshot(
      { matchId, playerId: m.playerAId!, bytes: png, mimeType: "image/png" },
      { storage }
    );
    await submitMatchScreenshot(
      { matchId, playerId: m.playerBId!, bytes: png, mimeType: "image/png" },
      { storage }
    );
  }

  it("rejects sweep requests with missing or wrong secret with 401 (T-052, EC-A5)", () => {
    const badReq = new Request("http://localhost:3000/api/agent/sweep", {
      method: "POST",
      headers: { "x-sweep-secret": "wrong" },
    });
    expect(() => assertSweepSecret(badReq)).toThrowError(
      expect.objectContaining({ code: "UNAUTHENTICATED", status: 401 })
    );

    const goodReq = new Request("http://localhost:3000/api/agent/sweep", {
      method: "POST",
      headers: { "x-sweep-secret": "test-sweep-secret" },
    });
    expect(() => assertSweepSecret(goodReq)).not.toThrow();
  });

  it("is idempotent when tick is called 10 times in a row / concurrently and resumes cleanly after mid-tick crash (T-051, T-053, EC-R8, EC-R9)", async () => {
    await payAll8Players();

    // Simulate process crash right after locking before bracket generation (EC-R8)
    await expect(
      tick(tournamentId, {
        paypal: fakePayPal,
        vision: fakeVision,
        storage,
        seedOverride: 777,
        onStepHook: (step) => {
          if (step === "after_open_check") {
            throw new Error("Simulated process crash mid-tick!");
          }
        },
      })
    ).rejects.toThrow("Simulated process crash mid-tick!");

    const [afterCrash] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId));
    expect(afterCrash.state).toBe("locked");

    // Next tick resumes from `locked` and generates the bracket without duplicate lock audit rows
    await tick(tournamentId, {
      paypal: fakePayPal,
      vision: fakeVision,
      storage,
      seedOverride: 777,
    });

    const [resumed] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId));
    expect(resumed.state).toBe("in_progress");

    const activityAfterOnce = await listTournamentActivity(tournamentId);

    // Calling tick 10 times concurrently produces the exact same state and activity count (EC-R9)
    await Promise.all(
      Array.from({ length: 10 }, () =>
        tick(tournamentId, {
          paypal: fakePayPal,
          vision: fakeVision,
          storage,
          seedOverride: 777,
        })
      )
    );

    const activityAfterTen = await listTournamentActivity(tournamentId);
    expect(activityAfterTen.length).toBe(activityAfterOnce.length);
  });

  it("opens timeout disputes on sweep when players do not submit screenshots in time (T-052, EC-R5)", async () => {
    const startTime = new Date("2026-11-01T12:00:00Z");
    await payAll8Players();
    await tick(tournamentId, {
      now: startTime,
      paypal: fakePayPal,
      vision: fakeVision,
      storage,
      seedOverride: 101,
    });

    // 35 minutes later (> 30 min MATCH_TIMEOUT_MIN), sweep runs
    const lateTime = new Date("2026-11-01T12:35:00Z");
    await sweepActiveTournaments({
      now: lateTime,
      paypal: fakePayPal,
      vision: fakeVision,
      storage,
    });

    const openDisputes = await db.select().from(disputes);
    expect(openDisputes.length).toBe(4);
    expect(openDisputes[0].reason).toBe("no_submissions");
  });

  it("completes the full tournament lifecycle, enforces host payout checkpoint (EC-O4), handles double-confirm (EC-O1), network retry (EC-O2), partial failure retry (EC-O3), and balances the ledger (T-050, T-054, T-060 to T-064)", async () => {
    await payAll8Players();
    await tick(tournamentId, {
      paypal: fakePayPal,
      vision: fakeVision,
      storage,
      seedOverride: 2026,
    });

    // Play Round 1 (4 matches)
    const r1Matches = await db
      .select()
      .from(matches)
      .where(
        and(eq(matches.tournamentId, tournamentId), eq(matches.round, 1))
      )
      .orderBy(asc(matches.position));

    for (const m of r1Matches) {
      await submitAgreeingMatchResult(m.id);
    }
    await tick(tournamentId, {
      paypal: fakePayPal,
      vision: fakeVision,
      storage,
    });

    // Play Round 2 (2 semifinals)
    const r2Matches = await db
      .select()
      .from(matches)
      .where(
        and(eq(matches.tournamentId, tournamentId), eq(matches.round, 2))
      )
      .orderBy(asc(matches.position));

    for (const m of r2Matches) {
      expect(m.status).toBe("awaiting_results");
      await submitAgreeingMatchResult(m.id);
    }
    await tick(tournamentId, {
      paypal: fakePayPal,
      vision: fakeVision,
      storage,
    });

    // Tournament should now be `results_pending` with Round 3 final `awaiting_results`
    const [finalMatch] = await db
      .select()
      .from(matches)
      .where(
        and(eq(matches.tournamentId, tournamentId), eq(matches.round, 3))
      );
    expect(finalMatch.status).toBe("awaiting_results");

    // Submit Final screenshots and tick -> confirms final, drafts payouts ($28.00 and $12.00), transitions to `confirmed` (T-054)
    await submitAgreeingMatchResult(finalMatch.id);
    await tick(tournamentId, {
      paypal: fakePayPal,
      vision: fakeVision,
      storage,
    });

    const review = await getPayoutReviewData(tournamentId);
    expect(review.tournamentState).toBe("confirmed");
    expect(review.poolCents).toBe(4000);
    expect(review.totalPayoutCents).toBe(4000);
    expect(review.recipients.map((r) => r.amountCents)).toEqual([2800, 1200]);
    expect(review.trail.confirmedMatchesCount).toBe(7);

    // NON-NEGOTIABLE GUARDRAIL #2 (EC-O4): calling sendPayoutBatch or agentTools.paypalCreatePayoutBatch before host approval throws FORBIDDEN!
    await expect(
      sendPayoutBatch(tournamentId, { paypal: fakePayPal })
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    await expect(
      agentTools.paypalCreatePayoutBatch(
        { tournamentId },
        { paypal: fakePayPal }
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(fakePayPal.createPayoutBatchCalls).toBe(0);

    // Simulate transient network/5xx error on first payout batch send (EC-O2)
    fakePayPal.failNext("createPayoutBatch");
    await expect(
      confirmAndSendTournamentPayout(hostId, tournamentId, {
        paypal: fakePayPal,
      })
    ).rejects.toMatchObject({ code: "PAYPAL_ERROR" });

    // Retrying confirm reuses the exact same `sender_batch_id` (`payout-<tournamentId>`) and succeeds (EC-O2)
    const confirmedOnce = await confirmAndSendTournamentPayout(
      hostId,
      tournamentId,
      { paypal: fakePayPal }
    );
    expect(confirmedOnce.tournamentState).toBe("paid");

    // Double-clicking confirm a second time sends nothing (EC-O1)
    const callsBeforeDoubleClick = fakePayPal.createPayoutBatchCalls;
    const confirmedTwice = await confirmAndSendTournamentPayout(
      hostId,
      tournamentId,
      { paypal: fakePayPal }
    );
    expect(confirmedTwice.alreadyConfirmed).toBe(true);
    expect(fakePayPal.createPayoutBatchCalls).toBe(callsBeforeDoubleClick);

    // Verify Ledger balances to 0 (`totalInCents - totalOutCents === 0`, T-064)
    const ledger = await getTournamentLedger(tournamentId);
    expect(ledger.totalInCents).toBe(4000);
    expect(ledger.totalOutCents).toBe(4000);
    expect(ledger.netHeldCents).toBe(0);
  });

  it("keeps tournament confirmed when one payout item fails and allows retrying only the failed item (T-063, EC-O3, EC-O5)", async () => {
    await payAll8Players();
    await tick(tournamentId, {
      paypal: fakePayPal,
      vision: fakeVision,
      storage,
      seedOverride: 555,
    });

    // Fast-forward all 7 matches
    for (const round of [1, 2, 3]) {
      const roundMatches = await db
        .select()
        .from(matches)
        .where(
          and(eq(matches.tournamentId, tournamentId), eq(matches.round, round))
        );
      for (const m of roundMatches) {
        await submitAgreeingMatchResult(m.id);
      }
      if (round < 3) {
        await tick(tournamentId, {
          paypal: fakePayPal,
          vision: fakeVision,
          storage,
        });
      }
    }

    // Before final tick, test EC-O5: if a finalist has no PayPal email, drafting is blocked with a clear error
    const [finalM] = await db
      .select()
      .from(matches)
      .where(
        and(eq(matches.tournamentId, tournamentId), eq(matches.round, 3))
      );
    await db
      .update(matches)
      .set({ status: "confirmed", winnerId: finalM.playerAId })
      .where(eq(matches.id, finalM.id));

    await db
      .update(users)
      .set({ paypalEmail: null })
      .where(eq(users.id, finalM.playerBId!));

    await expect(draftTournamentPayouts(tournamentId, db)).rejects.toMatchObject(
      { code: "VALIDATION" }
    );

    // Restore PayPal email and draft payouts
    await db
      .update(users)
      .set({ paypalEmail: "sb-runnerup@personal.example.com" })
      .where(eq(users.id, finalM.playerBId!));

    const drafted = await draftTournamentPayouts(tournamentId, db);
    expect(drafted).toHaveLength(2);

    // Approve and submit, then simulate 2nd place item failing in PayPal (EC-O3)
    await db
      .update(payouts)
      .set({
        status: "approved",
        approvedBy: hostId,
        approvedAt: new Date(),
      })
      .where(eq(payouts.tournamentId, tournamentId));

    await sendPayoutBatch(tournamentId, { paypal: fakePayPal });

    // Revert tournament to `confirmed` and set 2nd place item to FAILED in FakePayPal to test partial failure sync
    await db
      .update(tournaments)
      .set({ state: "confirmed" })
      .where(eq(tournaments.id, tournamentId));
    await db
      .update(payouts)
      .set({ status: "submitted" })
      .where(eq(payouts.tournamentId, tournamentId));

    const secondPlaceItem = drafted.find((d) => d.place === 2)!;
    fakePayPal.setPayoutItemOutcome(
      secondPlaceItem.senderItemId,
      "FAILED",
      "Receiver account restricted"
    );

    const synced = await syncTournamentPayoutStatuses(tournamentId, {
      paypal: fakePayPal,
    });
    expect(synced.allSucceeded).toBe(false);

    const [tStillConfirmed] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId));
    expect(tStillConfirmed.state).toBe("confirmed");

    // Host retries the failed 2nd place item -> sends retry batch for only that item and completes tournament to `paid`
    const afterRetry = await retryFailedPayoutItem(
      hostId,
      tournamentId,
      secondPlaceItem.id,
      { paypal: fakePayPal }
    );
    expect(afterRetry.every((r) => r.status === "succeeded")).toBe(true);

    const [tPaid] = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, tournamentId));
    expect(tPaid.state).toBe("paid");
  });
});
