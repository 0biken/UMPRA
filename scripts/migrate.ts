import { closeDatabase, getDb, runMigrations } from "../src/server/db";
import { MigrationReconciliationError } from "../src/server/db/migrate";
import { safeSetupError } from "../src/server/setup-config";
async function main() {
  try {
    await runMigrations(getDb());
    console.log("Database migrations applied atomically and schema verified.");
  } finally { await closeDatabase(); }
}
main().catch(error => {
  console.error(error instanceof MigrationReconciliationError ? error.message : safeSetupError(error));
  process.exitCode = 1;
});
