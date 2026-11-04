import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.cache/**", "tests/sandbox/**", "tests/e2e/**"],
    globals: true,
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
    maxWorkers: 1,
    env: {
      APP_URL: "http://localhost:3000",
      DATABASE_URL: "pglite://memory",
      SESSION_SECRET: "test-session-secret-with-at-least-32-bytes!!",
      PAYPAL_ENV: "sandbox",
      PAYPAL_CLIENT_ID: "test-paypal-client-id",
      PAYPAL_CLIENT_SECRET: "test-paypal-client-secret",
      PAYPAL_WEBHOOK_ID: "test-paypal-webhook-id",
      PAYPAL_WEBHOOK_VERIFY: "false",
      GEMINI_API_KEY: "test-gemini-key",
      VISION_MODEL: "gemini-flash-latest",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-supabase-service-role-key",
      SUPABASE_BUCKET: "screenshots",
      AGENT_SWEEP_SECRET: "test-sweep-secret",
      DEMO_MODE: "true",
      MATCH_TIMEOUT_MIN: "30",
      SECOND_SUBMISSION_TIMEOUT_MIN: "15",
      RUN_SANDBOX_TESTS: "0",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
