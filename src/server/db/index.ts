import { testOverrides } from "@/server/test-overrides";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { databaseConfigSchema, parseSetupConfig } from "@/server/setup-config";
import { runMigrations as applyMigrations } from "./migrate";
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
  const url = parseSetupConfig(databaseConfigSchema).DATABASE_URL;
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
    connect_timeout: 10,
    idle_timeout: 20,
    ...(new URL(url).hostname.endsWith("supabase.com") || new URL(url).hostname.endsWith("supabase.co") ? { ssl: "require" as const } : {}),
  });
  return drizzlePostgres(activePgClient, { schema }) as unknown as AppDatabase;
}

export function getDb(): AppDatabase {
  const override = testOverrides()?.db;
  if (override) return override;
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
  return applyMigrations(targetDb);
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
