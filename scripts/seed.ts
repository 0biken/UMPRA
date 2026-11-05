import { closeDatabase } from "../src/server/db";
import { seedDemoDatabase } from "../src/server/demo/seed";

async function main() {
  try {
    const summary = await seedDemoDatabase();
    console.log(
      JSON.stringify({
        level: "info",
        msg: "Database seed completed idempotently",
        ...summary,
      })
    );
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: "error",
      msg: "Database seed failed",
      error: err instanceof Error ? err.message : String(err),
    })
  );
  process.exit(1);
});
