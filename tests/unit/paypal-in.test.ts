import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { HttpPayPalClient } from "@/server/paypal/client";
import { FakePayPal } from "@/server/paypal/fake";
import {
  cancelEntryOrder,
  expireStalePendingEntries,
  getLivePrizePoolCents,
  joinTournamentAndCreateOrder,
  verifyAndCaptureEntryOrder,
} from "@/server/paypal/orders";
import {
  cancelAndRefundTournament,
  refundTournamentPayments,
} from "@/server/paypal/refunds";
import {
  handlePayPalWebhook,
  reprocessUnprocessedWebhookEvents,
} from "@/server/paypal/webhooks";
import {
  createTournament,
  openTournament,
} from "@/server/tournament/service";
import {
  entries,
  payments,
  resetTestDatabase,
  users,
  type AppDatabase,
} from "@/server/db";
import { AppError } from "@/lib/errors";

void AppError;

describe("PayPal client, join, capture, webhooks, pool, overflow, and refunds (T-030 to T-038)", () => {
  let db: AppDatabase;
  let fakePayPal: FakePayPal;
  let hostId: string;
  let playerIds: string[];
  let tournamentId: string;

  beforeEach(async () => {
    db = await resetTestDatabase();
    fakePayPal = new FakePayPal();

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
    for (let i = 1; i <= 10; i++) {
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
      title: "Lagos Knockout",
      game: "Football",
      entryFeeCents: 500,
      payoutSplit: { "1": 7000, "2": 3000 },
    });
    await openTournament(hostId, created.id);
    tournamentId = created.id;
  });

  it("caches OAuth token, refreshes on expiry, and maps non-2xx responses to AppError with debug id (T-030)", async () => {
    let nowMs = 1_000_000;
    let tokenCalls = 0;

    const mockFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/oauth2/token")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: `token-${tokenCalls}`,
            expires_in: 3600,
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          name: "INSTRUMENT_DECLINED",
          message: "Card declined",
        }),
        {
          status: 422,
          headers: { "paypal-debug-id": "dbg-999" },
        }
      );
    }) as unknown as typeof fetch;

    const client = new HttpPayPalClient({
      fetchImpl: mockFetch,
      nowFn: () => nowMs,
    });

    const t1 = await client.getAccessToken();
    const t2 = await client.getAccessToken();
    expect(t1).toBe("token-1");
    expect(t2).toBe("token-1");
    expect(tokenCalls).toBe(1);

    // Advance clock past expiry
    nowMs += 3600 * 1000;
    const t3 = await client.getAccessToken();
    expect(t3).toBe("token-2");
    expect(tokenCalls).toBe(2);

    // Non-2xx API error maps to AppError('PAYPAL_ERROR') with paypalDebugId
    await expect(client.getOrder("ORDER-ERR")).rejects.toMatchObject({
      code: "PAYPAL_ERROR",
      status: 502,
      details: { paypalDebugId: "dbg-999", status: 422 },
    });
  });

  it("reserves a slot, returns the same order on double-click (EC-P2), and rejects when full (T-032)", async () => {
    const first = await joinTournamentAndCreateOrder(
      {
        tournamentId,
        playerId: playerIds[0],
        gamertag: "Kemi1",
        paypalEmail: "sb-p1@personal.example.com",
      },
      { paypal: fakePayPal }
    );

    const secondClick = await joinTournamentAndCreateOrder(
      {
        tournamentId,
        playerId: playerIds[0],
        gamertag: "Kemi1",
        paypalEmail: "sb-p1@personal.example.com",
      },
      { paypal: fakePayPal }
    );

    expect(secondClick.entryId).toBe(first.entryId);
    expect(secondClick.orderId).toBe(first.orderId);

    // Fill remaining 7 slots
    for (let i = 1; i < 8; i++) {
      await joinTournamentAndCreateOrder(
        {
          tournamentId,
          playerId: playerIds[i],
          gamertag: `PlayerTag${i + 1}`,
          paypalEmail: `sb-p${i + 1}@personal.example.com`,
        },
        { paypal: fakePayPal }
      );
    }

    // 9th player gets TOURNAMENT_FULL
    await expect(
      joinTournamentAndCreateOrder(
        {
          tournamentId,
          playerId: playerIds[8],
          gamertag: "PlayerTag9",
          paypalEmail: "sb-p9@personal.example.com",
        },
        { paypal: fakePayPal }
      )
    ).rejects.toMatchObject({
      code: "TOURNAMENT_FULL",
      status: 409,
    });
  });

  it("captures once, is refresh-safe (EC-P3), updates live pool (T-035), and handles buyer cancel (EC-P1) & amount mismatch (EC-P10)", async () => {
    const join1 = await joinTournamentAndCreateOrder(
      {
        tournamentId,
        playerId: playerIds[0],
        gamertag: "Kemi1",
        paypalEmail: "sb-p1@personal.example.com",
      },
      { paypal: fakePayPal }
    );

    expect(await getLivePrizePoolCents(tournamentId)).toBe(0);

    fakePayPal.approveOrder(join1.orderId);
    const cap1 = await verifyAndCaptureEntryOrder(join1.entryId, {
      paypal: fakePayPal,
    });
    expect(cap1.status).toBe("captured");
    expect(await getLivePrizePoolCents(tournamentId)).toBe(500);
    expect(fakePayPal.captureOrderCalls).toBe(1);

    // Refreshing return URL does NOT call PayPal capture a second time (EC-P3)
    const refresh = await verifyAndCaptureEntryOrder(join1.entryId, {
      paypal: fakePayPal,
    });
    expect(refresh.status).toBe("already_captured");
    expect(fakePayPal.captureOrderCalls).toBe(1);

    // Buyer cancel frees the slot (EC-P1)
    const join2 = await joinTournamentAndCreateOrder(
      {
        tournamentId,
        playerId: playerIds[1],
        gamertag: "Tunde2",
        paypalEmail: "sb-p2@personal.example.com",
      },
      { paypal: fakePayPal }
    );
    await cancelEntryOrder(join2.entryId);
    const [cancelledEntry] = await db
      .select()
      .from(entries)
      .where(eq(entries.id, join2.entryId));
    expect(cancelledEntry.status).toBe("cancelled");

    // Amount mismatch on order verification is rejected (EC-P10)
    const join3 = await joinTournamentAndCreateOrder(
      {
        tournamentId,
        playerId: playerIds[2],
        gamertag: "Chidi3",
        paypalEmail: "sb-p3@personal.example.com",
      },
      { paypal: fakePayPal }
    );
    fakePayPal.approveOrder(join3.orderId, { amountCents: 100 }); // Tampered amount
    await expect(
      verifyAndCaptureEntryOrder(join3.entryId, { paypal: fakePayPal })
    ).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    expect(await getLivePrizePoolCents(tournamentId)).toBe(500);
  });

  it("automatically refunds overflow captures (EC-P7) and late captures after pending entry expiry (EC-P8, T-036, T-038)", async () => {
    const start = new Date("2026-11-01T12:00:00Z");

    // Player 1 joins at 12:00, then goes idle for 20 minutes
    const slowJoin = await joinTournamentAndCreateOrder(
      {
        tournamentId,
        playerId: playerIds[0],
        gamertag: "SlowPayer",
        paypalEmail: "sb-p1@personal.example.com",
      },
      { paypal: fakePayPal, now: start }
    );

    // 20 minutes later, sweep expires the pending entry (T-038)
    const twentyMinLater = new Date("2026-11-01T12:20:00Z");
    const expiredCount = await expireStalePendingEntries(tournamentId, {
      now: twentyMinLater,
    });
    expect(expiredCount).toBe(1);

    // SlowPayer now approves and hits return URL -> automatically refunded, NOT seated (EC-P8)
    fakePayPal.approveOrder(slowJoin.orderId);
    const lateOutcome = await verifyAndCaptureEntryOrder(slowJoin.entryId, {
      paypal: fakePayPal,
      now: twentyMinLater,
    });
    expect(lateOutcome.status).toBe("overflow_refunded");
    expect(await getLivePrizePoolCents(tournamentId)).toBe(0);

    // Now test EC-P7: two players racing for the 8th slot
    // First seat 7 paid players (players 1..7)
    for (let i = 1; i <= 7; i++) {
      const j = await joinTournamentAndCreateOrder(
        {
          tournamentId,
          playerId: playerIds[i],
          gamertag: `PaidTag${i}`,
          paypalEmail: `sb-p${i + 1}@personal.example.com`,
        },
        { paypal: fakePayPal, now: twentyMinLater }
      );
      fakePayPal.approveOrder(j.orderId);
      await verifyAndCaptureEntryOrder(j.entryId, {
        paypal: fakePayPal,
        now: twentyMinLater,
      });
    }
    expect(await getLivePrizePoolCents(tournamentId)).toBe(3500);

    // Player 8 reserves the 8th slot
    const p8Join = await joinTournamentAndCreateOrder(
      {
        tournamentId,
        playerId: playerIds[8],
        gamertag: "Player8",
        paypalEmail: "sb-p9@personal.example.com",
      },
      { paypal: fakePayPal, now: twentyMinLater }
    );

    // Suppose Player 9 also had a pending order created before expiry and both approve at the same time
    const [p9Entry] = await db
      .insert(entries)
      .values({
        tournamentId,
        playerId: playerIds[9],
        gamertag: "Player9",
        status: "pending",
        createdAt: twentyMinLater,
      })
      .returning();
    const p9Order = await fakePayPal.createOrder({
      entryId: p9Entry.id,
      tournamentTitle: "Lagos Knockout",
      amountCents: 500,
      returnUrl: "http://localhost:3000/api/paypal/return",
      cancelUrl: "http://localhost:3000/api/paypal/cancel",
      requestId: `entry-${p9Entry.id}`,
    });
    await db.insert(payments).values({
      tournamentId,
      entryId: p9Entry.id,
      paypalOrderId: p9Order.orderId,
      amountCents: 500,
      status: "created",
      idempotencyKey: `entry-${p9Entry.id}`,
    });

    fakePayPal.approveOrder(p8Join.orderId);
    fakePayPal.approveOrder(p9Order.orderId);

    const out8 = await verifyAndCaptureEntryOrder(p8Join.entryId, {
      paypal: fakePayPal,
      now: twentyMinLater,
    });
    const out9 = await verifyAndCaptureEntryOrder(p9Entry.id, {
      paypal: fakePayPal,
      now: twentyMinLater,
    });

    expect(out8.status).toBe("captured");
    expect(out9.status).toBe("overflow_refunded");
    expect(await getLivePrizePoolCents(tournamentId)).toBe(4000);
  });

  it("handles tournament cancel & refund with idempotent retry on partial failure (T-037, EC-P6)", async () => {
    for (let i = 0; i < 2; i++) {
      const j = await joinTournamentAndCreateOrder(
        {
          tournamentId,
          playerId: playerIds[i],
          gamertag: `P${i}`,
          paypalEmail: `sb-p${i}@personal.example.com`,
        },
        { paypal: fakePayPal }
      );
      fakePayPal.approveOrder(j.orderId);
      await verifyAndCaptureEntryOrder(j.entryId, { paypal: fakePayPal });
    }
    expect(await getLivePrizePoolCents(tournamentId)).toBe(1000);

    // Simulate first refund failing due to transient PayPal error
    fakePayPal.failNext("refundCapture");
    const firstAttempt = await cancelAndRefundTournament(
      hostId,
      tournamentId,
      "Host cancelled",
      { paypal: fakePayPal }
    );
    expect(firstAttempt.allRefunded).toBe(false);
    expect(firstAttempt.tournament.state).toBe("cancelled");

    // Retry refunds -> finishes remaining refund idempotently and transitions to 'refunded'
    const retry = await refundTournamentPayments(tournamentId, {
      paypal: fakePayPal,
    });
    expect(retry.allRefunded).toBe(true);
    expect(await getLivePrizePoolCents(tournamentId)).toBe(0);
  });

  it("verifies webhook signatures (EC-P9), deduplicates events (EC-P4), and reprocesses out-of-order webhooks (T-034)", async () => {
    const validHeaders = {
      authAlgo: "SHA256withRSA",
      certUrl: "https://api.sandbox.paypal.com/cert",
      transmissionId: "tx-1",
      transmissionSig: "sig-1",
      transmissionTime: "2026-11-01T12:00:00Z",
    };

    // Bad signature returns 400 (EC-P9)
    fakePayPal.setWebhookSignatureValid(false);
    await expect(
      handlePayPalWebhook(
        JSON.stringify({ id: "WH-BAD", event_type: "CHECKOUT.ORDER.APPROVED" }),
        validHeaders,
        { paypal: fakePayPal, verifySignature: true }
      )
    ).rejects.toMatchObject({ code: "VALIDATION", status: 400 });

    fakePayPal.setWebhookSignatureValid(true);

    // Out-of-order webhook arrives BEFORE entry/payment is written (EC-P4)
    const futureEntryId = "22222222-2222-4222-8222-222222222222";
    const earlyTime = new Date("2026-11-01T12:00:00Z");
    const earlyWebhook = await handlePayPalWebhook(
      JSON.stringify({
        id: "WH-EARLY-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-EARLY-1",
          custom_id: futureEntryId,
        },
      }),
      validHeaders,
      { paypal: fakePayPal, verifySignature: true, now: earlyTime }
    );
    expect(earlyWebhook.processed).toBe(false);

    // Now the entry and payment row are written
    await db.insert(entries).values({
      id: futureEntryId,
      tournamentId,
      playerId: playerIds[0],
      gamertag: "EarlyWebhookPlayer",
      status: "pending",
      createdAt: earlyTime,
    });
    await db.insert(payments).values({
      tournamentId,
      entryId: futureEntryId,
      amountCents: 500,
      status: "created",
      idempotencyKey: `entry-${futureEntryId}`,
    });

    // Sweep reprocesses unprocessed webhook events older than 1 minute
    const reprocessed = await reprocessUnprocessedWebhookEvents({
      paypal: fakePayPal,
      now: new Date("2026-11-01T12:02:00Z"),
    });
    expect(reprocessed).toBe(1);
    expect(await getLivePrizePoolCents(tournamentId)).toBe(500);

    // Duplicate delivery is a harmless no-op
    const dup = await handlePayPalWebhook(
      JSON.stringify({
        id: "WH-EARLY-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-EARLY-1",
          custom_id: futureEntryId,
        },
      }),
      validHeaders,
      { paypal: fakePayPal, verifySignature: true }
    );
    expect(dup.duplicate).toBe(true);
    expect(await getLivePrizePoolCents(tournamentId)).toBe(500);
  });
});
