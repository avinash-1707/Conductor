import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Time-skipping Temporal tests bundle workflows and (on first run)
    // download the test server — generous timeouts, still wall-clock fast.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
