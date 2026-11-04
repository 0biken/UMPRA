import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { DbOrTx } from "./index";
import * as schema from "./schema";

export const applicationTables = [schema.users, schema.tournaments, schema.entries, schema.payments,
  schema.matches, schema.submissions, schema.disputes, schema.payouts, schema.auditLog, schema.webhookEvents];
export const migrationDirectory = path.resolve(process.cwd(), "src/server/db/migrations");
export function migrationTags(): string[] {
  return (JSON.parse(fs.readFileSync(path.join(migrationDirectory, "meta/_journal.json"), "utf8")) as {
    entries: Array<{ tag: string }>;
  }).entries.map(entry => entry.tag);
}
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return (result as { rows?: T[] }).rows ?? [];
}

/** Metadata only; no application records or connection strings enter the report. */
export async function inspectDatabase(target: DbOrTx) {
  const tables = rowsOf<{ name: string; rls: boolean }>(await target.execute(sql`
    select c.relname as name, c.relrowsecurity as rls from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
  `));
  const hasLedger = tables.some(t => t.name === "__umpra_migrations");
  const applied = hasLedger ? rowsOf<{ tag: string }>(await target.execute(sql`select tag from public.__umpra_migrations order by tag`)).map(r => r.tag) : [];
  const known = migrationTags();
  const expected = applicationTables.map(t => getTableConfig(t));
  const appTables = tables.filter(t => expected.some(e => e.name === t.name));
  const problems: string[] = [];
  if (applied.some(tag => !known.includes(tag))) problems.push("Unknown migration history: reconcile before continuing.");
  if (!applied.includes("0000_initial") && appTables.length) problems.push("Application tables exist without the initial migration record; possible partial migration.");
  if (applied.includes("0000_initial")) {
    const columns = rowsOf<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(await target.execute(sql`
      select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='public'
    `));
    const constraints = rowsOf<{ table_name: string; count: number }>(await target.execute(sql`
      select c.relname as table_name,count(*)::int as count from pg_constraint k
      join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' group by c.relname
    `));
    const initial = fs.readFileSync(path.join(migrationDirectory, "0000_initial.sql"), "utf8");
    for (const table of expected) {
      if (!appTables.some(t => t.name === table.name)) { problems.push(`Missing table: ${table.name}`); continue; }
      for (const col of table.columns) {
        if (col.name === "recipient_paypal_email" && !applied.includes("0002_payout_recipient")) continue;
        const actual = columns.find(c => c.table_name === table.name && c.column_name === col.name);
        const type = col.getSQLType().replace("bigserial", "bigint");
        if (!actual || actual.data_type !== type || (col.notNull && actual.is_nullable !== "NO")) problems.push(`Missing or incompatible column: ${table.name}.${col.name}`);
      }
      const definition = initial.match(new RegExp(`create table ${table.name} \\(([\\s\\S]+?)\\n\\);`))?.[1] ?? "";
      const minimum = (definition.match(/\b(references|unique|check|primary key)\b/g) ?? []).length;
      if ((constraints.find(c => c.table_name === table.name)?.count ?? 0) < minimum) problems.push(`Missing constraints: ${table.name}`);
    }
    const indexes = rowsOf<{ indexname: string; indexdef: string }>(await target.execute(sql`select indexname,indexdef from pg_indexes where schemaname='public'`));
    for (const name of ["one_open_dispute_per_match", "audit_dedupe"]) {
      const index = indexes.find(i => i.indexname === name);
      if (!index || !index.indexdef.includes("UNIQUE") || !index.indexdef.includes("WHERE")) problems.push(`Missing partial unique index: ${name}`);
    }
    for (const [table, cols] of [["entries", "tournament_id,status"], ["matches", "tournament_id,status"], ["audit_log", "tournament_id,created_at"]]) {
      if (!indexes.some(i => i.indexdef.replace(/\s/g, "").includes(`public.${table}`) && i.indexdef.replace(/\s/g, "").includes(`(${cols})`))) problems.push(`Missing lookup index: ${table}(${cols})`);
    }
  }
  if (applied.includes("0001_server_only_rls")) for (const table of appTables) {
    if (!table.rls) problems.push(`RLS disabled: ${table.name}`);
  }
  return { tables: appTables, appliedMigrations: applied, missingMigrations: known.filter(tag => !applied.includes(tag)), problems };
}
