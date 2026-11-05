import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e", timeout: 300000, expect: { timeout: 60000 }, workers: 1,
  use: { baseURL: "http://localhost:3317", navigationTimeout: 90000, actionTimeout: 60000, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "mobile", use: { viewport: { width: 360, height: 800 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: { command: "node scripts/local-check.mjs dev", url: "http://localhost:3317/api/health", timeout: 180000, stdout: "pipe", reuseExistingServer: false },
});
