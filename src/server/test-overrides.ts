import type { AppDatabase } from "@/server/db";
import type { PayPalClient } from "@/server/paypal/client";
import type { StorageProvider } from "@/server/storage";
import type { VisionProvider } from "@/server/agent/vision/provider";

export interface TestOverrides { db: AppDatabase; paypal: PayPalClient; storage: StorageProvider; vision: VisionProvider }
declare global { var __umpraE2E: TestOverrides | undefined; }

/** Test doubles are usable only by the isolated local Playwright server. */
export function testOverrides(): TestOverrides | undefined {
  if (process.env.UMPRA_E2E !== "1") return undefined;
  if (process.env.NODE_ENV !== "development" || process.env.DATABASE_URL !== "pglite://memory" || process.env.PAYPAL_CLIENT_ID !== "test-paypal-client-id" || process.env.SUPABASE_SERVICE_ROLE_KEY !== "test-supabase-service-role-key" || !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(process.env.APP_URL ?? "")) {
    throw new Error("E2E providers require an isolated local development server and test credentials.");
  }
  return globalThis.__umpraE2E;
}
