import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { resetTestDatabase, users, tournaments, entries, payments, matches, submissions, payouts, auditLog, type AppDatabase } from "@/server/db";
import { MemoryStorageProvider } from "@/server/storage";
import { FakePayPal } from "@/server/paypal/fake";
import { joinTournamentAndCreateOrder } from "@/server/paypal/orders";
import { draftTournamentPayouts, getPayoutReviewData, confirmAndSendTournamentPayout, sendPayoutBatch, retryFailedPayoutItem } from "@/server/paypal/payouts";
import { submitMatchScreenshot } from "@/server/tournament/submissions";
import { agentTools } from "@/server/agent/tools";
import { setDisputeSummarizer } from "@/server/agent/summarize-dispute";
import { tick } from "@/server/agent/tick";
import { rowsOf } from "@/server/db/inspect";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe("backend correctness regressions", () => {
  let db: AppDatabase;
  let host: string, a: string, b: string, tournament: string, match: string;
  let storage: MemoryStorageProvider;
  const oldEmail = "original@personal.example.com";
  beforeEach(async () => {
    db = await resetTestDatabase();
    storage = new MemoryStorageProvider();
    const people = await db.insert(users).values([
      { email: "host@test.example", displayName: "Host", passwordHash: "hash", role: "host" as const },
      { email: "a@test.example", displayName: "A", passwordHash: "hash", role: "player" as const, paypalEmail: oldEmail },
      { email: "b@test.example", displayName: "B", passwordHash: "hash", role: "player" as const, paypalEmail: "b@personal.example.com" },
    ]).returning();
    [host, a, b] = people.map(p => p.id);
    const [t] = await db.insert(tournaments).values({ hostId: host, title: "Safety Cup", game: "Football", entryFeeCents: 500, payoutSplit: { "1": 7000, "2": 3000 }, state: "in_progress" }).returning();
    tournament = t.id;
    const seats = await db.insert(entries).values([{ tournamentId: t.id, playerId: a, gamertag: "A", status: "paid" }, { tournamentId: t.id, playerId: b, gamertag: "B", status: "paid" }]).returning();
    await db.insert(payments).values({ tournamentId: t.id, entryId: seats[0].id, amountCents: 500, status: "captured", idempotencyKey: `entry-${seats[0].id}` });
    const [m] = await db.insert(matches).values({ tournamentId: t.id, round: 3, position: 0, playerAId: a, playerBId: b, status: "awaiting_results", awaitingSince: new Date("2026-11-01T00:00:00Z") }).returning();
    match = m.id;
  });
  afterEach(() => setDisputeSummarizer(null));

  async function draft() {
    await db.update(matches).set({ status: "confirmed", winnerId: a }).where(eq(matches.id, match));
    return db.transaction(tx => draftTournamentPayouts(tournament, tx));
  }
  async function upload() {
    return submitMatchScreenshot({ matchId: match, playerId: a, bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }, { storage });
  }
  const extraction = JSON.stringify({ readable: true, game_over: true, home: { name: "A", score: 3 }, away: { name: "B", score: 1 }, confidence: 0.95, notes: "clear" });

  it("keeps the reviewed destination through profile changes, approval, sending and retry", async () => {
    const drafted = await draft();
    await db.update(users).set({ paypalEmail: "changed@personal.example.com" }).where(eq(users.id, a));
    expect((await getPayoutReviewData(tournament)).recipients.find(r => r.recipientId === a)?.paypalEmail).toBe(oldEmail);
    const paypal = new FakePayPal();
    const result = await confirmAndSendTournamentPayout(host, tournament, { paypal });
    const winner = result.payouts.find(p => p.recipientId === a)!;
    expect((await paypal.getPayoutBatch(winner.paypalBatchId!)).items.find(i => i.senderItemId === winner.senderItemId)?.receiver).toBe(oldEmail);
    await db.update(payouts).set({ status: "failed" }).where(eq(payouts.id, winner.id));
    const retried = await retryFailedPayoutItem(host, tournament, winner.id, { paypal });
    const retry = retried.find(p => p.id === winner.id)!;
    expect((await paypal.getPayoutBatch(retry.paypalBatchId!)).items[0].receiver).toBe(oldEmail);
    expect(drafted[0].recipientPaypalEmail).toBe(oldEmail);
  });

  it("refuses a missing frozen destination even after host approval", async () => {
    await draft();
    await db.update(payouts).set({ recipientPaypalEmail: "", status: "approved", approvedBy: host, approvedAt: new Date() }).where(eq(payouts.tournamentId, tournament));
    const paypal = new FakePayPal();
    await expect(sendPayoutBatch(tournament, { paypal })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(paypal.createPayoutBatchCalls).toBe(0);
  });

  it("does not change a profile on a rejected join", async () => {
    await expect(joinTournamentAndCreateOrder({ tournamentId: tournament, playerId: a, gamertag: "AA", paypalEmail: "changed@personal.example.com" }, { paypal: new FakePayPal() })).rejects.toMatchObject({ code: "ALREADY_DONE" });
    expect((await db.select().from(users).where(eq(users.id, a)))[0].paypalEmail).toBe(oldEmail);
  });

  it("discards an old extraction after a screenshot replacement", async () => {
    const first = await upload();
    const started = deferred<void>(), finish = deferred<string>();
    const pending = agentTools.extractScore({ submissionId: first.id, tournamentId: tournament, gamertag: "A", expectedGamertags: ["A", "B"] }, { storage, vision: { extractRaw: async () => { started.resolve(); return finish.promise; } } });
    await started.promise;
    const replacement = await upload();
    finish.resolve(extraction);
    expect(await pending).toBeNull();
    const [saved] = await db.select().from(submissions).where(eq(submissions.id, first.id));
    expect(saved.screenshotPath).toBe(replacement.screenshotPath);
    expect(saved.extractionStatus).toBe("pending");
    expect(saved.attempts).toBe(0);
    expect(saved.extractedJson).toBeNull();
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "evidence.extracted"))).toHaveLength(0);
  });

  it("commits one extraction and audit when two model calls finish concurrently", async () => {
    const sub = await upload();
    const started = deferred<void>(), finish = deferred<string>();
    let calls = 0;
    const vision = { extractRaw: async () => { if (++calls === 2) started.resolve(); return finish.promise; } };
    const input = { submissionId: sub.id, tournamentId: tournament, gamertag: "A", expectedGamertags: ["A", "B"] as [string, string] };
    const pending = Promise.all([agentTools.extractScore(input, { storage, vision }), agentTools.extractScore(input, { storage, vision })]);
    await started.promise; finish.resolve(extraction);
    expect((await pending).filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "evidence.extracted"))).toHaveLength(1);
  });

  it("releases DB locks during summarization and reevaluates replacement evidence", async () => {
    const started = deferred<void>(), finish = deferred<string>();
    setDisputeSummarizer(async () => { started.resolve(); return finish.promise; });
    const pending = tick(tournament, { now: new Date("2026-11-01T01:00:00Z") });
    await started.promise;
    await db.transaction(async tx => {
      const [lock] = rowsOf<{ available: boolean }>(await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${tournament}::text)) as available`));
      expect(lock.available).toBe(true);
    });
    await upload();
    finish.resolve("Old no-submission summary must not be saved.");
    await pending;
    // New evidence changes the decision from timeout dispute to waiting for the opponent.
    expect((await db.select().from(matches).where(and(eq(matches.id, match), eq(matches.status, "awaiting_results"))))).toHaveLength(1);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "dispute.opened"))).toHaveLength(0);
  });
});
