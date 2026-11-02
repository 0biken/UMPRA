import { createClient } from "@supabase/supabase-js";
import { env } from "../src/server/env";
import { ALLOWED_SCREENSHOT_MIMES, MAX_SCREENSHOT_BYTES } from "../src/server/storage";
const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession:false } });
async function main() {
  const { data, error } = await client.storage.getBucket(env.SUPABASE_BUCKET);
  const options = { public:false, fileSizeLimit:MAX_SCREENSHOT_BYTES, allowedMimeTypes:[...ALLOWED_SCREENSHOT_MIMES] };
  if (error && error.message !== "Bucket not found" && !String(error.statusCode).startsWith("404")) throw new Error(`Unable to inspect screenshot bucket: ${error.message}`);
  const result = data ? await client.storage.updateBucket(env.SUPABASE_BUCKET, options) : await client.storage.createBucket(env.SUPABASE_BUCKET, options);
  if (result.error) throw new Error(result.error.message);
  const verify = await client.storage.getBucket(env.SUPABASE_BUCKET);
  if (verify.error || verify.data?.public !== false) throw new Error("Private storage verification failed.");
  console.log("Private screenshot bucket configured and verified.");
}
main().catch(err=>{ console.error(err instanceof Error ? err.message : "Storage setup failed"); process.exitCode=1; });
