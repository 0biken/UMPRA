import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { env } from "@/server/env";
import { db, entries, matches, payments, payouts, submissions, tournaments, users, resetTestDatabase } from "@/server/db";
import { createTournament, openTournament, getTournamentDetails } from "@/server/tournament/service";
import { fillTournamentWithDemoPlayers, submitDemoMatchScreenshots } from "@/server/demo/service";
import { seedDemoDatabase } from "@/server/demo/seed";
import { FakePayPal } from "@/server/paypal/fake";
import { FakeVision } from "@/server/agent/vision/provider";
import { MemoryStorageProvider } from "@/server/storage";
import { joinTournamentAndCreateOrder, verifyAndCaptureEntryOrder, getLivePrizePoolCents } from "@/server/paypal/orders";
import { draftTournamentPayouts, confirmAndSendTournamentPayout, getTournamentLedger } from "@/server/paypal/payouts";
import { getSubmissionReadUrl } from "@/server/tournament/evidence";
import { resolveDisputeByHost } from "@/server/tournament/disputes";
import { tick } from "@/server/agent/tick";
import { parseTournamentPrompt } from "@/server/agent/parse-tournament";

vi.mock("@/server/agent/summarize-dispute", async importOriginal => {
  const actual = await importOriginal<typeof import("@/server/agent/summarize-dispute")>();
  return { ...actual, generateDisputeSummary: vi.fn(async () => "The submitted screenshots disagree; the host must select a winner.") };
});

describe("release regressions: demo funds, authorization, evidence and lifecycle", () => {
  let hostId: string, playerId: string, tournamentId: string;
  let paypal: FakePayPal, vision: FakeVision, storage: MemoryStorageProvider;
  const originalEmails = env.DEMO_PAYPAL_RECIPIENTS;
  beforeEach(async () => {
    await resetTestDatabase();
    env.DEMO_PAYPAL_RECIPIENTS = Array.from({ length: 8 }, (_, i) => `sb-demo-${i}@personal.example.com`);
    paypal = new FakePayPal(); vision = new FakeVision(); storage = new MemoryStorageProvider();
    const [host] = await db.insert(users).values({ email: "release-host@umpra.test", displayName: "Host", role: "host", passwordHash: "hash" }).returning();
    const [player] = await db.insert(users).values({ email: "release-player@umpra.test", displayName: "Real Player", role: "player", passwordHash: "hash", paypalEmail: "sb-real@personal.example.com" }).returning();
    hostId = host.id; playerId = player.id;
    const t = await createTournament(hostId, { title: "Release Cup", game: "Spot Kick Club", entryFeeCents: 500, payoutSplit: { "1": 7000, "2": 3000 } });
    tournamentId = t.id; await openTournament(hostId, t.id);
  });
  afterEach(() => { env.DEMO_PAYPAL_RECIPIENTS = originalEmails; });
  async function fund() {
    const join = await joinTournamentAndCreateOrder({ tournamentId, playerId, gamertag: "RealPlayer", paypalEmail: "sb-real@personal.example.com" }, { paypal });
    paypal.approveOrder(join.orderId);
    await verifyAndCaptureEntryOrder(join.entryId, { paypal });
  }
  it("refuses unfunded demo filling, non-owner controls and missing recipients without creating payments", async () => {
    await expect(fillTournamentWithDemoPlayers(tournamentId, playerId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fillTournamentWithDemoPlayers(tournamentId, hostId)).rejects.toThrow(/checkout/);
    expect(await db.select().from(payments)).toHaveLength(0);
    await fund(); env.DEMO_PAYPAL_RECIPIENTS = [];
    await expect(fillTournamentWithDemoPlayers(tournamentId, hostId)).rejects.toThrow(/recipient/);
  });
  it("fills concurrently and repeatedly with seven simulated entries and only one captured fee", async () => {
    await fund();
    await Promise.all([fillTournamentWithDemoPlayers(tournamentId, hostId, { paypal }), fillTournamentWithDemoPlayers(tournamentId, hostId, { paypal })]);
    await fillTournamentWithDemoPlayers(tournamentId, hostId, { paypal });
    const es = await db.select().from(entries).where(eq(entries.tournamentId, tournamentId));
    expect(es).toHaveLength(8); expect(es.filter(e => e.simulated)).toHaveLength(7);
    expect(await db.select().from(payments)).toHaveLength(1);
    expect(await getLivePrizePoolCents(tournamentId)).toBe(500);
    expect(await db.select().from(matches)).toHaveLength(7);
  });
  it("seeds repeatedly without fake captures or payouts and demo mode off refuses controls (EC-A4)", async () => {
    await seedDemoDatabase(); await seedDemoDatabase();
    expect(await db.select().from(payments)).toHaveLength(0);
    expect(await db.select().from(payouts)).toHaveLength(0);
    const prior = env.DEMO_MODE;
    try { env.DEMO_MODE = false; await expect(fillTournamentWithDemoPlayers(tournamentId, hostId)).rejects.toMatchObject({ status: 404 }); }
    finally { env.DEMO_MODE = prior; }
  });
  it("never drafts an invented all-bot pool", async () => {
    await fund(); await fillTournamentWithDemoPlayers(tournamentId, hostId, { paypal });
    const es = await db.select().from(entries).where(eq(entries.tournamentId, tournamentId));
    const [final] = await db.select().from(matches).where(eq(matches.round, 3));
    await db.update(matches).set({ playerAId: es[0].playerId, playerBId: es[1].playerId, winnerId: es[0].playerId, status: "confirmed" }).where(eq(matches.id, final.id));
    await db.delete(payments);
    await db.update(entries).set({ simulated: true });
    await expect(draftTournamentPayouts(tournamentId)).rejects.toThrow(/zero-balance/);
    expect(await db.select().from(payouts)).toHaveLength(0);
  });
  it("runs generated images through vision, protects evidence, resolves a mismatch and pays only captured funds", async () => {
    await fund(); await fillTournamentWithDemoPlayers(tournamentId, hostId, { paypal });
    let first = true;
    for (let round = 1; round <= 3; round++) {
      const ms = await db.select().from(matches).where(eq(matches.round, round));
      for (const m of ms) {
        const es = await db.select().from(entries);
        const a = es.find(e => e.playerId === m.playerAId)!.gamertag;
        const b = es.find(e => e.playerId === m.playerBId)!.gamertag;
        vision.enqueue({ readable: true, game_over: true, home: { name: a, score: 3 }, away: { name: b, score: 1 }, confidence: 0.99, notes: "Final" });
        vision.enqueue({ readable: true, game_over: true, home: { name: a, score: first ? 1 : 3 }, away: { name: b, score: first ? 3 : 1 }, confidence: 0.99, notes: "Final" });
        await expect(submitDemoMatchScreenshots({ matchId: m.id, scenario: "agree" }, playerId, { paypal, vision, storage })).rejects.toMatchObject({ code: "FORBIDDEN" });
        await submitDemoMatchScreenshots({ matchId: m.id, scenario: first ? "mismatch" : "agree" }, hostId, { paypal, vision, storage });
        const [sub] = await db.select().from(submissions).where(eq(submissions.matchId, m.id));
        expect((await storage.downloadScreenshot(sub.screenshotPath)).bytes.byteLength).toBeGreaterThan(200);
        await expect(getSubmissionReadUrl(sub.id, "00000000-0000-4000-8000-000000000000", storage)).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(await getSubmissionReadUrl(sub.id, hostId, storage)).toMatch(/^data:image\/png/);
        const pub = await getTournamentDetails(tournamentId);
        expect(JSON.stringify(pub)).not.toContain("screenshotPath");
        expect(JSON.stringify(pub)).not.toContain("paypalEmail");
        if (first) {
          const pm = pub.matches.find(x => x.id === m.id)!;
          expect(pm.dispute?.summary).toBeNull(); expect(pm.submissions.every(s => s.extractedJson === null)).toBe(true);
          const owned = await getTournamentDetails(tournamentId, db, hostId);
          const d = owned.matches.find(x => x.id === m.id)!.dispute!;
          expect(d.summary).toBeTruthy();
          await resolveDisputeByHost(hostId, d.id, { resolution: "winner_a", note: "Reviewed both screenshots" });
          await tick(tournamentId, { paypal, vision, storage }); first = false;
        }
        await submitDemoMatchScreenshots({ matchId: m.id, scenario: "agree" }, hostId, { paypal, vision, storage });
        expect(await db.select().from(submissions).where(eq(submissions.matchId, m.id))).toHaveLength(2);
      }
    }
    const drafted = await db.select().from(payouts);
    expect(drafted.map(p => p.amountCents).sort((a,b) => b-a)).toEqual([350,150]);
    await confirmAndSendTournamentPayout(hostId, tournamentId, { paypal });
    const ledger = await getTournamentLedger(tournamentId);
    expect(ledger.totalInCents).toBe(500); expect(ledger.totalOutCents).toBe(500); expect(ledger.netHeldCents).toBe(0);
  });
  it("deadline sweep cancels and refunds verified fees exactly once (EC-P5)", async () => {
    await fund();
    const now = new Date();
    await db.update(tournaments).set({ registrationClosesAt: new Date(now.getTime()-1000) }).where(eq(tournaments.id,tournamentId));
    await tick(tournamentId,{paypal,now}); await tick(tournamentId,{paypal,now});
    expect((await db.select().from(tournaments).where(eq(tournaments.id,tournamentId)))[0].state).toBe("refunded");
    expect(paypal.refundCaptureCalls).toBe(1);
    expect(await getLivePrizePoolCents(tournamentId)).toBe(0);
  });
  it("Data API roles see no private rows even when granted SELECT", async () => {
    await db.execute(sql.raw("create role ump_ra_browser_test"));
    await db.execute(sql.raw("grant usage on schema public to ump_ra_browser_test"));
    await db.execute(sql.raw("grant select on all tables in schema public to ump_ra_browser_test"));
    await db.transaction(async tx => {
      await tx.execute(sql.raw("set local role ump_ra_browser_test"));
      expect(await tx.select().from(users)).toHaveLength(0);
      expect(await tx.select().from(tournaments)).toHaveLength(0);
    });
    expect(await db.select().from(users)).not.toHaveLength(0);
  });
  it("parser rejects unsupported player counts even when model output silently changes them (EC-S2)", async () => {
    const r = await parseTournamentPrompt("16 players, $5, winner 70%, runner-up 30%", { llmCall: async () => JSON.stringify({ slots: 8, entry_fee_usd: 5, payout_split: [{ place: 1, percent: 70 }, { place: 2, percent: 30 }] }) });
    expect(r.valid).toBe(false); expect(r.problems.join(" ")).toContain("16");
    expect((await parseTournamentPrompt("8-player $5 winner 70% runner-up 30%", { llmCall: async () => "broken" })).valid).toBe(true);
  });
});
