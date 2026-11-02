import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type UserRole = "host" | "player";

export type TournamentState =
  | "draft"
  | "open"
  | "locked"
  | "in_progress"
  | "results_pending"
  | "confirmed"
  | "paid"
  | "cancelled"
  | "refunded";

export type EntryStatus =
  | "pending"
  | "paid"
  | "cancelled"
  | "expired"
  | "refunded";

export type PaymentStatus =
  | "created"
  | "approved"
  | "captured"
  | "failed"
  | "refund_pending"
  | "refunded";

export type MatchStatus =
  | "waiting"
  | "awaiting_results"
  | "disputed"
  | "confirmed";

export type MatchSlot = "a" | "b";

export type ExtractionStatus = "pending" | "ok" | "malformed" | "unreadable";

export type DisputeStatus = "open" | "resolved";
export type DisputeResolution = "winner_a" | "winner_b";

export type PayoutStatus =
  | "drafted"
  | "approved"
  | "submitted"
  | "succeeded"
  | "failed"
  | "unclaimed";

export type AuditActorType = "agent" | "user" | "system" | "paypal";

export type PayoutSplitBps = Record<string, number>;

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").$type<UserRole>().notNull(),
    paypalEmail: text("paypal_email"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("users_role_check", sql`${table.role} in ('host', 'player')`),
  ]
).enableRLS();

export const tournaments = pgTable(
  "tournaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    game: text("game").notNull(),
    format: text("format").notNull().default("single_elimination"),
    slots: integer("slots").notNull().default(8),
    entryFeeCents: integer("entry_fee_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    payoutSplit: jsonb("payout_split").$type<PayoutSplitBps>().notNull(),
    state: text("state").$type<TournamentState>().notNull().default("draft"),
    bracketSeed: integer("bracket_seed"),
    registrationClosesAt: timestamp("registration_closes_at", {
      withTimezone: true,
    }),
    championId: uuid("champion_id").references(() => users.id),
    cancelReason: text("cancel_reason"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("tournaments_slots_check", sql`${table.slots} = 8`),
    check(
      "tournaments_entry_fee_cents_check",
      sql`${table.entryFeeCents} between 100 and 2000`
    ),
    check("tournaments_currency_check", sql`${table.currency} = 'USD'`),
  ]
).enableRLS();

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    playerId: uuid("player_id")
      .notNull()
      .references(() => users.id),
    gamertag: text("gamertag").notNull(),
    status: text("status")
      .$type<EntryStatus>()
      .notNull()
      .default("pending"),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("entries_tournament_player_unique").on(
      table.tournamentId,
      table.playerId
    ),
    unique("entries_tournament_gamertag_unique").on(
      table.tournamentId,
      table.gamertag
    ),
    index("entries_tournament_status_idx").on(
      table.tournamentId,
      table.status
    ),
    check(
      "entries_status_check",
      sql`${table.status} in ('pending', 'paid', 'cancelled', 'expired', 'refunded')`
    ),
  ]
).enableRLS();

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    entryId: uuid("entry_id")
      .notNull()
      .unique()
      .references(() => entries.id),
    paypalOrderId: text("paypal_order_id").unique(),
    paypalCaptureId: text("paypal_capture_id").unique(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status")
      .$type<PaymentStatus>()
      .notNull()
      .default("created"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    refundId: text("refund_id"),
    stateAtCapture: text("state_at_capture"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "payments_status_check",
      sql`${table.status} in ('created', 'approved', 'captured', 'failed', 'refund_pending', 'refunded')`
    ),
  ]
).enableRLS();

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    round: integer("round").notNull(),
    position: integer("position").notNull(),
    playerAId: uuid("player_a_id").references(() => users.id),
    playerBId: uuid("player_b_id").references(() => users.id),
    status: text("status")
      .$type<MatchStatus>()
      .notNull()
      .default("waiting"),
    winnerId: uuid("winner_id").references(() => users.id),
    nextMatchId: uuid("next_match_id").references((): AnyPgColumn => matches.id),
    nextSlot: text("next_slot").$type<MatchSlot>(),
    awaitingSince: timestamp("awaiting_since", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("matches_tournament_round_position_unique").on(
      table.tournamentId,
      table.round,
      table.position
    ),
    index("matches_tournament_status_idx").on(
      table.tournamentId,
      table.status
    ),
    check(
      "matches_status_check",
      sql`${table.status} in ('waiting', 'awaiting_results', 'disputed', 'confirmed')`
    ),
    check(
      "matches_next_slot_check",
      sql`${table.nextSlot} is null or ${table.nextSlot} in ('a', 'b')`
    ),
  ]
).enableRLS();

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    playerId: uuid("player_id")
      .notNull()
      .references(() => users.id),
    screenshotPath: text("screenshot_path").notNull(),
    extractionStatus: text("extraction_status")
      .$type<ExtractionStatus>()
      .notNull()
      .default("pending"),
    extractedJson: jsonb("extracted_json"),
    confidence: real("confidence"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("submissions_match_player_unique").on(
      table.matchId,
      table.playerId
    ),
    check(
      "submissions_extraction_status_check",
      sql`${table.extractionStatus} in ('pending', 'ok', 'malformed', 'unreadable')`
    ),
  ]
).enableRLS();

export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    reason: text("reason").notNull(),
    summary: text("summary").notNull(),
    status: text("status")
      .$type<DisputeStatus>()
      .notNull()
      .default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolution: text("resolution").$type<DisputeResolution>(),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("one_open_dispute_per_match")
      .on(table.matchId)
      .where(sql`${table.status} = 'open'`),
    check(
      "disputes_status_check",
      sql`${table.status} in ('open', 'resolved')`
    ),
    check(
      "disputes_resolution_check",
      sql`${table.resolution} is null or ${table.resolution} in ('winner_a', 'winner_b')`
    ),
  ]
).enableRLS();

export const payouts = pgTable(
  "payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id),
    place: integer("place").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status")
      .$type<PayoutStatus>()
      .notNull()
      .default("drafted"),
    senderBatchId: text("sender_batch_id").notNull(),
    senderItemId: text("sender_item_id").notNull().unique(),
    paypalBatchId: text("paypal_batch_id"),
    paypalItemId: text("paypal_item_id"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("payouts_tournament_place_unique").on(
      table.tournamentId,
      table.place
    ),
    check("payouts_amount_cents_check", sql`${table.amountCents} > 0`),
    check(
      "payouts_status_check",
      sql`${table.status} in ('drafted', 'approved', 'submitted', 'succeeded', 'failed', 'unclaimed')`
    ),
  ]
).enableRLS();

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tournamentId: uuid("tournament_id").references(() => tournaments.id),
    actorType: text("actor_type").$type<AuditActorType>().notNull(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("audit_dedupe")
      .on(table.tournamentId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    index("audit_log_tournament_created_idx").on(
      table.tournamentId,
      table.createdAt
    ),
    check(
      "audit_log_actor_type_check",
      sql`${table.actorType} in ('agent', 'user', 'system', 'paypal')`
    ),
  ]
).enableRLS();

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  verified: boolean("verified").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}).enableRLS();
