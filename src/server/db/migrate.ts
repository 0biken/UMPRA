import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { AppDatabase } from "./index";
import { inspectDatabase, migrationDirectory, migrationTags, rowsOf } from "./inspect";

export class MigrationReconciliationError extends Error {
  readonly code = "MIGRATION_RECONCILIATION";
}

export async function runMigrations(target: AppDatabase, options?: {
  /** Crash injection for rollback regression tests. */
  afterStatement?: (tag: string, index: number) => void;
}): Promise<void> {
  await target.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(184733901)`);
    const report = await inspectDatabase(tx);
    if (report.problems.length) throw new MigrationReconciliationError(`Migration reconciliation required: ${report.problems.join("; ")}`);
    // A legacy destination may already have been paid externally. Never infer or reapprove it.
    if (report.tables.some(t => t.name === "payouts") && report.missingMigrations.includes("0002_payout_recipient")) {
      const legacy = rowsOf<{ count: number }>(await tx.execute(sql`select count(*)::int as count from public.payouts`));
      if (legacy[0]?.count) throw new MigrationReconciliationError(`Migration reconciliation required: ${legacy[0].count} legacy payout records need provider reconciliation and frozen recipients.`);
      const column = rowsOf(await tx.execute(sql`select 1 from information_schema.columns where table_schema='public' and table_name='payouts' and column_name='recipient_paypal_email'`));
      if (column.length) throw new MigrationReconciliationError("Migration reconciliation required: payout recipient column exists without its migration record.");
    }
    await tx.execute(sql`create table if not exists public.__umpra_migrations (tag text primary key, applied_at timestamptz not null default now())`);
    await tx.execute(sql`alter table public.__umpra_migrations enable row level security`);
    for (const tag of migrationTags()) {
      if (report.appliedMigrations.includes(tag)) continue;
      const statements = fs.readFileSync(path.join(migrationDirectory, `${tag}.sql`), "utf8").split("--> statement-breakpoint").map(s => s.trim()).filter(Boolean);
      for (const [index, statement] of statements.entries()) {
        await tx.execute(sql.raw(statement));
        options?.afterStatement?.(tag, index);
      }
      await tx.execute(sql`insert into public.__umpra_migrations(tag) values (${tag})`);
    }
    const verified = await inspectDatabase(tx);
    if (verified.problems.length) throw new MigrationReconciliationError(`Schema verification failed: ${verified.problems.join("; ")}`);
  });
}
