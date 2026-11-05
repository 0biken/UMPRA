import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { runMigrations } from "@/server/db/migrate";
import { inspectDatabase, rowsOf } from "@/server/db/inspect";
import * as schema from "@/server/db/schema";
import type { AppDatabase } from "@/server/db";
import { databaseConfigSchema, storageConfigSchema, parseSetupConfig } from "@/server/setup-config";

describe("atomic migrations and setup isolation", () => {
  let client: PGlite;
  let db: AppDatabase;
  beforeEach(() => { client = new PGlite(); db = drizzle(client, { schema }) as unknown as AppDatabase; });
  afterEach(async () => { await client.close(); });

  it("validates database/storage settings without payment credentials", () => {
    expect(parseSetupConfig(databaseConfigSchema, { DATABASE_URL: "pglite://memory" })).toEqual({ DATABASE_URL: "pglite://memory" });
    expect(parseSetupConfig(storageConfigSchema, { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key", SUPABASE_BUCKET: "screenshots" }).SUPABASE_BUCKET).toBe("screenshots");
    expect(() => parseSetupConfig(databaseConfigSchema, {})).toThrow(/DATABASE_URL/);
  });

  it("rolls back schema and migration history after interruption and resumes cleanly", async () => {
    await expect(runMigrations(db, { afterStatement: (_tag, index) => { if (index === 2) throw new Error("crash"); } })).rejects.toThrow("crash");
    expect((await inspectDatabase(db)).tables).toHaveLength(0);
    await runMigrations(db);
    const report = await inspectDatabase(db);
    expect(report.problems).toEqual([]);
    expect(report.missingMigrations).toEqual([]);
    expect(report.tables).toHaveLength(10);
    expect(report.tables.every(t => t.rls)).toBe(true);
  });

  it("serializes concurrent runners and records every migration once", async () => {
    await Promise.all([runMigrations(db), runMigrations(db), runMigrations(db)]);
    const records = rowsOf<{ tag: string }>(await db.execute(sql`select tag from __umpra_migrations`));
    expect(records).toHaveLength(3);
    expect(new Set(records.map(r => r.tag)).size).toBe(3);
  });

  it("refuses a partial schema without modifying existing objects", async () => {
    await db.execute(sql`create table public.users (id uuid primary key)`);
    await expect(runMigrations(db)).rejects.toThrow(/partial migration/);
    expect((await inspectDatabase(db)).tables.map(t => t.name)).toEqual(["users"]);
  });

  it("refuses legacy payout records before adding or inferring a destination", async () => {
    await runMigrations(db);
    const [host] = await db.insert(schema.users).values({ email: "legacy@test.example", passwordHash: "hash", displayName: "Legacy", role: "host" }).returning();
    const [t] = await db.insert(schema.tournaments).values({ hostId: host.id, title: "Legacy", game: "Football", entryFeeCents: 500, payoutSplit: { "1": 10000 } }).returning();
    await db.insert(schema.payouts).values({ tournamentId: t.id, recipientId: host.id, recipientPaypalEmail: "legacy@personal.example.com", place: 1, amountCents: 500, senderBatchId: "legacy", senderItemId: "legacy" });
    await db.execute(sql`alter table payouts drop column recipient_paypal_email`);
    await db.execute(sql`delete from __umpra_migrations where tag='0002_payout_recipient'`);
    await expect(runMigrations(db)).rejects.toThrow(/legacy payout records/);
    expect(rowsOf(await db.execute(sql`select id from payouts`))).toHaveLength(1);
    expect(rowsOf(await db.execute(sql`select 1 from information_schema.columns where table_name='payouts' and column_name='recipient_paypal_email'`))).toHaveLength(0);
  });

  it("denies restricted roles even when they have table privileges", async () => {
    await runMigrations(db);
    await db.insert(schema.users).values({ email: "private@test.example", passwordHash: "hash", displayName: "Private", role: "host" });
    for (const role of ["anon", "authenticated"]) {
      await client.exec(`create role ${role} nologin nosuperuser nobypassrls; grant usage on schema public to ${role}; grant select,insert,update,delete on all tables in schema public to ${role};`);
      await db.transaction(async tx => {
        await tx.execute(sql.raw(`set local role ${role}`));
        expect(rowsOf(await tx.execute(sql`select id from users`))).toEqual([]);
      });
      await expect(client.exec(`begin; set local role ${role}; insert into users(email,password_hash,display_name,role) values ('blocked@test.example','hash','Blocked','host');`)).rejects.toThrow(/row-level security/);
      await client.exec("rollback");
      expect((await db.select().from(schema.users))).toHaveLength(1);
    }
  });
});
