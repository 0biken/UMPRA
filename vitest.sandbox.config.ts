import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: { include: ["tests/sandbox/**/*.test.ts"], testTimeout: 180000, hookTimeout: 30000, fileParallelism: false },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
