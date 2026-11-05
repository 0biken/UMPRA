/** Public test fixtures only. Never use this environment for deployed verification. */
export const localEnv = {
  APP_URL: "http://localhost:3317", DATABASE_URL: "pglite://memory",
  SESSION_SECRET: "local-isolated-test-session-secret-32-bytes",
  PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "test-paypal-client-id", PAYPAL_CLIENT_SECRET: "test-paypal-client-secret",
  PAYPAL_WEBHOOK_ID: "test-paypal-webhook-id", PAYPAL_WEBHOOK_VERIFY: "true",
  GEMINI_API_KEY: "test-gemini-key", SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-supabase-service-role-key", SUPABASE_BUCKET: "screenshots",
  AGENT_SWEEP_SECRET: "test-sweep-secret", DEMO_MODE: "true",
  DEMO_PAYPAL_RECIPIENTS: Array.from({length:8},(_,i)=>`test-recipient-${i}@personal.example.com`).join(","),
};
