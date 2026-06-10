import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for apps/web. Operator/CI-run only — NOT part of the root
 * `pnpm test` gate (browsers must be installed first:
 * `pnpm --filter @conductor/web exec playwright install chromium`).
 *
 * The Unit 18 snapshot test mocks every network call (auth + `/runs`), so the
 * dev server needs no backend. `NEXT_PUBLIC_SERVER_URL` points at a stub origin
 * that is never actually reached.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `next dev --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_SERVER_URL: "http://localhost:4999" },
  },
});
