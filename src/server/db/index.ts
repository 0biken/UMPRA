import fs from "fs";
import path from "path";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { env } from "@/server/env";
import * as schema from "./schema";

export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export type DbTransaction = Parameters<
  Parameters<AppDatabase["transaction"]>[0]
>[0];

export type DbOrTx = AppDatabase | DbTransaction;

let activeDb: AppDatabase | null = null;
let activePglite: PGlite | null = null;
let activePgClient: ReturnType<typeof postgres> | null = null;
let isTestDbMigrated = false;

function createDatabaseFromEnv(): AppDatabase {
  const url = env.DATABASE_URL;
  if (url.startsWith("pglite://")) {
    const target = url.replace("pglite://", "");
    activePglite =
      target === "memory" || target === ""
        ? new PGlite()
        : new PGlite(target);
    return drizzlePglite(activePglite, { schema }) as unknown as AppDatabase;
  }

  activePgClient = postgres(url, {
    max: 10,
    prepare: false,
  });
  return drizzlePostgres(activePgClient, { schema }) as unknown as AppDatabase;
}

export function getDb(): AppDatabase {
  if (!activeDb) {
    activeDb = createDatabaseFromEnv();
  }
  return activeDb;
}

export const db: AppDatabase = new Proxy({} as AppDatabase, {
  get(_target, prop, receiver) {
    const instance = getDb();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export async function runMigrations(targetDb: AppDatabase = getDb()): Promise<void> {
  await targetDb.execute(sql`
    create table if not exists __umpra_migrations (
      tag text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const migrationsDir = path.resolve(
    process.cwd(),
    "src/server/db/migrations"
  );
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");
  const journalRaw = fs.readFileSync(journalPath, "utf8");
  const journal = JSON.parse(journalRaw) as {
    entries: Array<{ tag: string }>;
  };

  for (const entry of journal.entries) {
    const existing = await targetDb.execute<{ tag: string }>(
      sql`select tag from __umpra_migrations where tag = ${entry.tag}`
    );
    const rows = Array.isArray(existing)
      ? existing
      : (existing as unknown as { rows?: Array<{ tag: string }> }).rows ?? [];
    if (rows.length > 0) {
      continue;
    }

    const sqlFile = path.join(migrationsDir, `${entry.tag}.sql`);
    const content = fs.readFileSync(sqlFile, "utf8");
    const statements = content
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await targetDb.execute(sql.raw(stmt));
    }

    await targetDb.execute(
      sql`insert into __umpra_migrations (tag) values (${entry.tag})`
    );
  }
}

/**
 * Ensures the test database is migrated from empty on first run, and truncates all tables between tests.
 */
export async function resetTestDatabase(): Promise<AppDatabase> {
  if (!activePglite || !activeDb) {
    activePglite = new PGlite();
    activeDb = drizzlePglite(activePglite, { schema }) as unknown as AppDatabase;
    isTestDbMigrated = false;
  }
  if (!isTestDbMigrated) {
    await runMigrations(activeDb);
    isTestDbMigrated = true;
  } else {
    await activeDb.execute(sql`
      truncate table
        webhook_events,
        audit_log,
        payouts,
        disputes,
        submissions,
        matches,
        payments,
        entries,
        tournaments,
        users
      restart identity cascade
    `);
  }
  return activeDb;
}

export async function closeDatabase(): Promise<void> {
  if (activePglite) {
    await activePglite.close();
    activePglite = null;
  }
  if (activePgClient) {
    await activePgClient.end();
    activePgClient = null;
  }
  activeDb = null;
  isTestDbMigrated = false;
}

export * from "./schema";
