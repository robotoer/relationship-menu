import { defineConfig } from "vitest/config";

// Tests that run in Node rather than inside the Workers runtime: they start the
// whole Worker (asset router included) with Wrangler's test harness.
export default defineConfig({
  test: {
    include: ["test-node/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
