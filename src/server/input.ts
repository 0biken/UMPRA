import { AppError } from "@/lib/errors";

/** Bound untrusted request bodies before parsing/validation, including chunked requests. */
export async function readBody(req: Request, limit = 16 * 1024): Promise<Uint8Array> {
  const length = req.headers.get("content-length");
  if (length && Number(length) > limit) throw new AppError("VALIDATION", "Request is too large.", 413);
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) { await reader.cancel(); throw new AppError("VALIDATION", "Request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJson(req: Request): Promise<unknown> {
  try { return JSON.parse(new TextDecoder().decode(await readBody(req))); }
  catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("VALIDATION", "Invalid JSON. Check the request and try again.", 400);
  }
}

export async function readScreenshotForm(req: Request): Promise<FormData> {
  const bytes = await readBody(req, 5 * 1024 * 1024 + 16 * 1024);
  try {
    return await new Response(Buffer.from(bytes), { headers: { "Content-Type": req.headers.get("content-type") ?? "" } }).formData();
  } catch { throw new AppError("UPLOAD_REJECTED", "Invalid upload. Select a PNG, JPEG, or WebP screenshot.", 400); }
}
