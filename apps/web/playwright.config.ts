import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for apps/web. Operator/CI-run only — NOT part of the root
 * `pnpm test` gate (browsers must be installed first:
 * `pnpm --filter @conductor/web exec playwright install chromium`).
 *
 * Two specs, two strategies:
 * - `runs-dashboard.spec.ts` (Unit 18 snapshot) mocks every network call —
 *   it never reaches a backend.
 * - `golden-path.spec.ts` (Unit 23) runs against the REAL stack with a
 *   stubbed model: web (:3100) + server (:4100) boot below; the worker
 *   (`LLM_MODE=mock`, no HTTP surface until the deploy unit) is spawned in
 *   globalSetup. Both run on the isolated `conductor-e2e` task queue so a
 *   stale dev worker can never steal activities. Docker infra (Postgres,
 *   Redis, Temporal) must be up: `docker compose -f infra/docker-compose.yml up -d`.
 */
const PORT = 3100;
const SERVER_PORT = 4100;
const E2E_TASK_QUEUE = "conductor-e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup",
  globalTeardown: "./e2e/global-teardown",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `next dev --port ${PORT}`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { NEXT_PUBLIC_SERVER_URL: `http://localhost:${SERVER_PORT}` },
    },
    {
      command: "pnpm start",
      cwd: "../server",
      url: `http://localhost:${SERVER_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        SERVER_PORT: String(SERVER_PORT),
        WEB_ORIGIN: `http://localhost:${PORT}`,
        BETTER_AUTH_URL: `http://localhost:${SERVER_PORT}`,
        TEMPORAL_TASK_QUEUE: E2E_TASK_QUEUE,
        // The golden path stores a stub OpenRouter key — skip the Unit 33
        // live verification (the dev/E2E facility, refused in production).
        KEY_VERIFICATION: "off",
      },
    },
  ],
});
