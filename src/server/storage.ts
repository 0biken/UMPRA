import { createClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { env } from "@/server/env";

export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_SCREENSHOT_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type AllowedScreenshotMime = (typeof ALLOWED_SCREENSHOT_MIMES)[number];

const EXT_BY_MIME: Record<AllowedScreenshotMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function validateScreenshotUpload(input: {
  byteLength: number;
  mimeType: string;
}): AllowedScreenshotMime {
  if (
    typeof input.byteLength !== "number" ||
    !Number.isFinite(input.byteLength) ||
    input.byteLength <= 0
  ) {
    throw new AppError(
      "UPLOAD_REJECTED",
      "The uploaded screenshot file is empty. Select a valid image and try again.",
      400
    );
  }

  if (input.byteLength > MAX_SCREENSHOT_BYTES) {
    throw new AppError(
      "UPLOAD_REJECTED",
      "Screenshot exceeds the 5 MB limit. Resize or compress the image and try again.",
      400
    );
  }

  const normalizedMime = input.mimeType.trim().toLowerCase();
  if (
    !ALLOWED_SCREENSHOT_MIMES.includes(
      normalizedMime as AllowedScreenshotMime
    )
  ) {
    throw new AppError(
      "UPLOAD_REJECTED",
      "Unsupported file format. Upload a PNG, JPEG, or WebP screenshot.",
      400
    );
  }

  return normalizedMime as AllowedScreenshotMime;
}

export interface StorageProvider {
  uploadScreenshot(params: {
    matchId: string;
    playerId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{ path: string; mimeType: AllowedScreenshotMime }>;

  downloadScreenshot(path: string): Promise<{
    bytes: Uint8Array;
    mimeType: AllowedScreenshotMime;
  }>;

  getSignedReadUrl(path: string, expiresInSeconds?: number): Promise<string>;
}

/**
 * In-memory storage provider used in tests and local demo runs when Supabase Storage is not reachable.
 */
export class MemoryStorageProvider implements StorageProvider {
  private files = new Map<
    string,
    { bytes: Uint8Array; mimeType: AllowedScreenshotMime }
  >();

  public async uploadScreenshot(params: {
    matchId: string;
    playerId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{ path: string; mimeType: AllowedScreenshotMime }> {
    const validMime = validateScreenshotUpload({
      byteLength: params.bytes.byteLength,
      mimeType: params.mimeType,
    });
    const ext = EXT_BY_MIME[validMime];
    const path = `matches/${params.matchId}/${params.playerId}-${newId()}.${ext}`;
    this.files.set(path, {
      bytes: new Uint8Array(params.bytes),
      mimeType: validMime,
    });
    return { path, mimeType: validMime };
  }

  public putFixture(
    path: string,
    bytes: Uint8Array,
    mimeType: AllowedScreenshotMime = "image/png"
  ): void {
    this.files.set(path, { bytes: new Uint8Array(bytes), mimeType });
  }

  public async downloadScreenshot(path: string): Promise<{
    bytes: Uint8Array;
    mimeType: AllowedScreenshotMime;
  }> {
    const found = this.files.get(path);
    if (!found) {
      // Return a 1x1 transparent PNG fallback if a seeded demo path is requested
      const fallbackPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64"
      );
      return { bytes: new Uint8Array(fallbackPng), mimeType: "image/png" };
    }
    return {
      bytes: new Uint8Array(found.bytes),
      mimeType: found.mimeType,
    };
  }

  public async getSignedReadUrl(path: string): Promise<string> {
    const found = this.files.get(path);
    if (!found) {
      return `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`;
    }
    const b64 = Buffer.from(found.bytes).toString("base64");
    return `data:${found.mimeType};base64,${b64}`;
  }
}

export class SupabaseStorageProvider implements StorageProvider {
  private readonly fallback = new MemoryStorageProvider();

  private isPlaceholderSupabase(): boolean {
    return (
      env.SUPABASE_URL.includes("example.supabase.co") ||
      env.SUPABASE_SERVICE_ROLE_KEY === "test-supabase-service-role-key"
    );
  }

  private getClient() {
    return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }

  public async uploadScreenshot(params: {
    matchId: string;
    playerId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{ path: string; mimeType: AllowedScreenshotMime }> {
    const validMime = validateScreenshotUpload({
      byteLength: params.bytes.byteLength,
      mimeType: params.mimeType,
    });

    if (this.isPlaceholderSupabase()) {
      return this.fallback.uploadScreenshot(params);
    }

    const ext = EXT_BY_MIME[validMime];
    const objectPath = `matches/${params.matchId}/${params.playerId}-${newId()}.${ext}`;
    const supabase = this.getClient();

    const { error } = await supabase.storage
      .from(env.SUPABASE_BUCKET)
      .upload(objectPath, params.bytes, {
        contentType: validMime,
        upsert: true,
      });

    if (error) {
      throw new AppError(
        "UPLOAD_REJECTED",
        `Failed to store screenshot: ${error.message}`,
        502
      );
    }

    return { path: objectPath, mimeType: validMime };
  }

  public async downloadScreenshot(path: string): Promise<{
    bytes: Uint8Array;
    mimeType: AllowedScreenshotMime;
  }> {
    if (this.isPlaceholderSupabase()) {
      return this.fallback.downloadScreenshot(path);
    }

    const supabase = this.getClient();
    const { data, error } = await supabase.storage
      .from(env.SUPABASE_BUCKET)
      .download(path);

    if (error || !data) {
      throw new AppError(
        "NOT_FOUND",
        `Screenshot not found in storage: ${path}`,
        404
      );
    }

    const arrayBuffer = await data.arrayBuffer();
    const mimeType: AllowedScreenshotMime = path.endsWith(".jpg")
      ? "image/jpeg"
      : path.endsWith(".webp")
        ? "image/webp"
        : "image/png";

    return {
      bytes: new Uint8Array(arrayBuffer),
      mimeType,
    };
  }

  public async getSignedReadUrl(
    path: string,
    expiresInSeconds = 3600
  ): Promise<string> {
    if (this.isPlaceholderSupabase()) {
      return this.fallback.getSignedReadUrl(path);
    }

    const supabase = this.getClient();
    const { data, error } = await supabase.storage
      .from(env.SUPABASE_BUCKET)
      .createSignedUrl(path, expiresInSeconds);

    if (error || !data?.signedUrl) {
      return this.fallback.getSignedReadUrl(path);
    }

    return data.signedUrl;
  }
}

let activeStorageProvider: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (!activeStorageProvider) {
    activeStorageProvider = new SupabaseStorageProvider();
  }
  return activeStorageProvider;
}

export function setStorageProvider(provider: StorageProvider | null): void {
  activeStorageProvider = provider;
}
