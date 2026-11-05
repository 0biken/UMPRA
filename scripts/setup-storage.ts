import { createClient } from "@supabase/supabase-js";
import { parseSetupConfig, storageConfigSchema, ALLOWED_SCREENSHOT_MIMES, MAX_SCREENSHOT_BYTES, safeSetupError } from "../src/server/setup-config";
async function main() {
  const env = parseSetupConfig(storageConfigSchema);
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await client.storage.listBuckets();
  if (error) throw error;
  const options = { public: false, fileSizeLimit: MAX_SCREENSHOT_BYTES, allowedMimeTypes: [...ALLOWED_SCREENSHOT_MIMES] };
  const result = data.some(b => b.name === env.SUPABASE_BUCKET)
    ? await client.storage.updateBucket(env.SUPABASE_BUCKET, options)
    : await client.storage.createBucket(env.SUPABASE_BUCKET, options);
  if (result.error) throw result.error;
  const verify = await client.storage.getBucket(env.SUPABASE_BUCKET);
  if (verify.error || verify.data?.public !== false || Number(verify.data.file_size_limit) !== MAX_SCREENSHOT_BYTES || ALLOWED_SCREENSHOT_MIMES.some(m => !verify.data.allowed_mime_types?.includes(m))) throw new Error("Bucket verification failed");
  console.log("Private screenshot bucket configured: 5 MB, PNG/JPEG/WebP.");
}
main().catch(error => { console.error(safeSetupError(error)); process.exitCode = 1; });
