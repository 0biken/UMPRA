import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { getDb, closeDatabase } from "../src/server/db";
import { inspectDatabase } from "../src/server/db/inspect";
import { parseSetupConfig, storageConfigSchema, safeSetupError, MAX_SCREENSHOT_BYTES, ALLOWED_SCREENSHOT_MIMES } from "../src/server/setup-config";

async function main() {
  let ready = true;
  try {
    const report = await getDb().transaction(async tx => {
      await tx.execute(sql`set transaction read only`);
      return inspectDatabase(tx);
    });
    const ok = !report.missingMigrations.length && !report.problems.length && report.tables.length === 10;
    ready &&= ok;
    console.log(JSON.stringify({ check: "database", connected: true, ready: ok, ...report }));
  } catch (error) {
    ready = false;
    console.log(JSON.stringify({ check: "database", connected: false, code: safeSetupError(error) }));
  } finally { await closeDatabase(); }
  try {
    const env = parseSetupConfig(storageConfigSchema);
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await client.storage.getBucket(env.SUPABASE_BUCKET);
    if (error) throw error;
    const ok = data.public === false && Number(data.file_size_limit) === MAX_SCREENSHOT_BYTES &&
      data.allowed_mime_types?.length === ALLOWED_SCREENSHOT_MIMES.length && ALLOWED_SCREENSHOT_MIMES.every(m => data.allowed_mime_types?.includes(m));
    ready &&= Boolean(ok);
    console.log(JSON.stringify({ check: "storage", ready: Boolean(ok), private: !data.public, sizeLimit: data.file_size_limit, mimeTypes: data.allowed_mime_types }));
  } catch (error) {
    ready = false;
    console.log(JSON.stringify({ check: "storage", ready: false, code: safeSetupError(error) }));
  }
  const missing = ["SESSION_SECRET", "AGENT_SWEEP_SECRET", "PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "GEMINI_API_KEY"].filter(key => !process.env[key]?.trim());
  console.log(JSON.stringify({ check: "application-config", missing }));
  if (!ready || missing.length) process.exitCode = 1;
}
main().catch(error => { console.error(safeSetupError(error)); process.exitCode = 1; });
