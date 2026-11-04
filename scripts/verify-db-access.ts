import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { getDb, closeDatabase } from "../src/server/db";
import { applicationTables, inspectDatabase, rowsOf } from "../src/server/db/inspect";
import { safeSetupError } from "../src/server/setup-config";

async function main() {
  try {
    const db = getDb();
    const schema = await inspectDatabase(db);
    if (schema.missingMigrations.length || schema.problems.length || schema.tables.some(t => !t.rls)) throw new Error("Schema must be ready before access verification");
    const policies = rowsOf<{ tablename: string }>(await db.execute(sql`select tablename from pg_policies where schemaname='public'`));
    if (policies.some(p => schema.tables.some(t => t.name === p.tablename))) throw new Error("Unexpected application table policies require review");
    for (const role of ["anon", "authenticated"]) {
      const roles = rowsOf<{ rolsuper: boolean; rolbypassrls: boolean }>(await db.execute(sql`select rolsuper,rolbypassrls from pg_roles where rolname=${role}`));
      if (roles.length !== 1 || roles[0].rolsuper || roles[0].rolbypassrls) throw new Error("Restricted role configuration is unsafe");
      for (const table of applicationTables.map(t => getTableConfig(t).name)) {
        try {
          await db.transaction(async tx => {
            await tx.execute(sql`set transaction read only`);
            // Both role and table identifiers come exclusively from the fixed allowlists above.
            await tx.execute(sql.raw(`set local role ${role}`));
            const rows = rowsOf(await tx.execute(sql.raw(`select 1 from public."${table}" limit 1`)));
            if (rows.length) throw new Error("Restricted role can read application records");
          });
        } catch (error) {
          const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
          if (code !== "42501") throw error; // Permission denied is also a valid denial.
        }
      }
      console.log(JSON.stringify({ check: "database-role", role, tables: applicationTables.length, access: "denied", rls: true, applicationPolicies: 0 }));
    }
  } finally { await closeDatabase(); }
}
main().catch(error => { console.error(safeSetupError(error)); process.exitCode = 1; });
