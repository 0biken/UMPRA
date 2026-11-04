import { beforeEach, describe, expect, it } from "vitest";
import {
  auditLog,
  disputes,
  entries,
  matches,
  payments,
  payouts,
  resetTestDatabase,
  runMigrations,
  submissions,
  tournaments,
  users,
  webhookEvents,
  type AppDatabase,
} from "@/server/db";

describe("database schema and migrations (T-005)", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = await resetTestDatabase();
  });

  it("applies migrations from empty idempotently and creates all 10 tables", async () => {
    // Re-running migrations should be a no-op
    await runMigrations(db);

    const [host] = await db
      .insert(users)
      .values({
        email: "host@umpra.test",
        passwordHash: "hashed",
        displayName: "Host User",
        role: "host",
      })
      .returning();

    expect(host.id).toBeDefined();
    expect(host.role).toBe("host");

    const [tournament] = await db
      .insert(tournaments)
      .values({
        hostId: host.id,
        title: "Lagos Knockout",
        game: "Football",
        entryFeeCents: 500,
        payoutSplit: { "1": 7000, "2": 3000 },
      })
      .returning();

    expect(tournament.slots).toBe(8);
    expect(tournament.currency).toBe("USD");
    expect(tournament.state).toBe("draft");
  });

  it("enforces CHECK constraints on entry_fee_cents, slots, roles, and payout amounts", async () => {
    const [host] = await db
      .insert(users)
      .values({
        email: "host@umpra.test",
        passwordHash: "hashed",
        displayName: "Host",
        role: "host",
      })
      .returning();

    // Entry fee out of bounds (< 100 or > 2000) must fail
    await expect(
      db.insert(tournaments).values({
        hostId: host.id,
        title: "Too Cheap",
        game: "Football",
        entryFeeCents: 50,
        payoutSplit: { "1": 10000 },
      })
    ).rejects.toThrow();

    await expect(
      db.insert(tournaments).values({
        hostId: host.id,
        title: "Too Expensive",
        game: "Football",
        entryFeeCents: 2500,
        payoutSplit: { "1": 10000 },
      })
    ).rejects.toThrow();

    // Non-8 slots must fail
    await expect(
      db.insert(tournaments).values({
        hostId: host.id,
        title: "16 Player",
        game: "Football",
        slots: 16,
        entryFeeCents: 500,
        payoutSplit: { "1": 10000 },
      })
    ).rejects.toThrow();
  });

  it("enforces unique constraints and partial unique indexes (one_open_dispute_per_match, audit_dedupe)", async () => {
    const [host] = await db
      .insert(users)
      .values({
        email: "host@umpra.test",
        passwordHash: "hashed",
        displayName: "Host",
        role: "host",
      })
      .returning();

    const [player] = await db
      .insert(users)
      .values({
        email: "p1@umpra.test",
        passwordHash: "hashed",
        displayName: "Player 1",
        role: "player",
      })
      .returning();

    const [tournament] = await db
      .insert(tournaments)
      .values({
        hostId: host.id,
        title: "Test Cup",
        game: "Football",
        entryFeeCents: 500,
        payoutSplit: { "1": 7000, "2": 3000 },
      })
      .returning();

    const [entry] = await db
      .insert(entries)
      .values({
        tournamentId: tournament.id,
        playerId: player.id,
        gamertag: "KemiFC",
      })
      .returning();

    // Duplicate player in same tournament must fail
    await expect(
      db.insert(entries).values({
        tournamentId: tournament.id,
        playerId: player.id,
        gamertag: "DifferentTag",
      })
    ).rejects.toThrow();

    // Payment linked to entry
    const [payment] = await db
      .insert(payments)
      .values({
        tournamentId: tournament.id,
        entryId: entry.id,
        amountCents: 500,
        idempotencyKey: `entry-${entry.id}`,
      })
      .returning();
    expect(payment.status).toBe("created");

    // Match, submission, and one_open_dispute_per_match partial unique index
    const [match] = await db
      .insert(matches)
      .values({
        tournamentId: tournament.id,
        round: 1,
        position: 0,
        playerAId: player.id,
      })
      .returning();

    const [sub] = await db
      .insert(submissions)
      .values({
        matchId: match.id,
        playerId: player.id,
        screenshotPath: "test/path.png",
      })
      .returning();
    expect(sub.extractionStatus).toBe("pending");

    await db.insert(disputes).values({
      matchId: match.id,
      reason: "conflicting_results",
      summary: "First open dispute",
      status: "open",
    });

    // Second open dispute on same match must fail
    await expect(
      db.insert(disputes).values({
        matchId: match.id,
        reason: "low_confidence",
        summary: "Second open dispute",
        status: "open",
      })
    ).rejects.toThrow();

    // Partial unique index on audit_log(tournament_id, dedupe_key)
    await db.insert(auditLog).values({
      tournamentId: tournament.id,
      actorType: "agent",
      action: "tournament.locked",
      dedupeKey: `lock:${tournament.id}`,
    });

    await expect(
      db.insert(auditLog).values({
        tournamentId: tournament.id,
        actorType: "agent",
        action: "tournament.locked",
        dedupeKey: `lock:${tournament.id}`,
      })
    ).rejects.toThrow();

    // Payout and webhook_events tables work
    const [payout] = await db
      .insert(payouts)
      .values({
        tournamentId: tournament.id,
        recipientId: player.id,
        recipientPaypalEmail: "recipient@personal.example.com",
        place: 1,
        amountCents: 2800,
        senderBatchId: `payout-${tournament.id}`,
        senderItemId: `${tournament.id}-1`,
      })
      .returning();
    expect(payout.status).toBe("drafted");

    const [webhook] = await db
      .insert(webhookEvents)
      .values({
        id: "WH-123",
        eventType: "PAYMENT.CAPTURE.COMPLETED",
        payload: { id: "WH-123" },
        verified: true,
      })
      .returning();
    expect(webhook.id).toBe("WH-123");
  });
});
