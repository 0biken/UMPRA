import { closeDatabase, getDb, runMigrations } from "@/server/db";

async function main() {
  const db = getDb();
  await runMigrations(db);
  console.log(
    JSON.stringify({
      level: "info",
      msg: "Database migrations applied successfully",
    })
  );
  await closeDatabase();
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "Database migration failed",
      error: err instanceof Error ? err.message : String(err),
    })
  );
  process.exit(1);
});
