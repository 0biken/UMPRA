import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseSetupConfig, storageConfigSchema, safeSetupError } from "../src/server/setup-config";

async function main() {
  const env = parseSetupConfig(storageConfigSchema);
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const bucket = client.storage.from(env.SUPABASE_BUCKET);
  const object = `setup-verification/${randomUUID()}.png`;
  const image = fs.readFileSync("public/demo-screenshots/matching-a.png");
  let uploaded = false;
  try {
    const upload = await bucket.upload(object, image, { contentType: "image/png", upsert: false });
    if (upload.error) throw upload.error;
    uploaded = true;
    const download = await bucket.download(object);
    if (download.error || !download.data || !Buffer.from(await download.data.arrayBuffer()).equals(image)) throw new Error("Authenticated download mismatch");
    const signed = await bucket.createSignedUrl(object, 60);
    if (signed.error) throw signed.error;
    const fetched = await fetch(signed.data.signedUrl, { signal: AbortSignal.timeout(15000) });
    if (!fetched.ok || !Buffer.from(await fetched.arrayBuffer()).equals(image)) throw new Error("Signed download mismatch");
    for (const route of ["public", "authenticated"]) {
      const anonymous = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${route}/${encodeURIComponent(env.SUPABASE_BUCKET)}/${object}`, { signal: AbortSignal.timeout(15000) });
      if (anonymous.status < 400 || anonymous.status >= 500) throw new Error("Anonymous denial was not verified");
    }
    console.log("Storage verified: authenticated upload/download, 60-second signed read, anonymous reads denied.");
  } finally {
    if (uploaded) {
      const deleted = await bucket.remove([object]);
      if (deleted.error) throw new Error("Verification object cleanup failed");
      const remaining = await bucket.list("setup-verification", { search: object.split("/")[1] });
      if (remaining.error || remaining.data.length) throw new Error("Verification object cleanup not confirmed");
      console.log("Temporary verification object removed.");
    }
  }
}
main().catch(error => { console.error(safeSetupError(error)); process.exitCode = 1; });
