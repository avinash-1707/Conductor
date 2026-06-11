import { test, expect, type Page } from "@playwright/test";

/**
 * Unit 18 — populated Run Dashboard snapshot. Every network call is mocked so
 * the page renders deterministically with no backend: Better Auth session/org
 * lookups, the API JWT exchange, and `GET /runs`. The Socket.IO endpoint is
 * left to fail (the connection indicator simply reads "offline"); the rows are
 * the subject of the snapshot.
 */

// Must match the config's NEXT_PUBLIC_SERVER_URL (the golden-path E2E server).
// Every call this spec makes is intercepted by page.route before the network.
const SERVER = "http://localhost:4100";
const SESSION_TOKEN_KEY = "conductor.session-token";

const RUNS_FIXTURE = {
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      workflowName: "contentPipeline",
      temporalWorkflowId: "content-running",
      temporalRunId: "r-1",
      status: "running",
      input: { topic: "Durable AI workflows", keywords: ["temporal"], tone: "technical", wordCount: 1200, approverId: "u-1" },
      output: null,
      error: null,
      resumedFromRunId: null,
      startedAt: "2026-06-10T11:59:00.000Z",
      completedAt: null,
      createdAt: "2026-06-10T11:59:00.000Z",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      workflowName: "contentPipeline",
      temporalWorkflowId: "content-suspended",
      temporalRunId: "r-2",
      status: "suspended",
      input: { topic: "SEO that lasts", keywords: ["seo"], tone: "authoritative", wordCount: 1500, approverId: "u-1" },
      output: null,
      error: null,
      resumedFromRunId: null,
      startedAt: "2026-06-10T11:55:00.000Z",
      completedAt: null,
      createdAt: "2026-06-10T11:55:00.000Z",
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      workflowName: "contentPipeline",
      temporalWorkflowId: "content-failed",
      temporalRunId: "r-3",
      status: "failed",
      input: { topic: "Edge cases", keywords: ["bugs"], tone: "casual", wordCount: 800, approverId: "u-1" },
      output: null,
      error: "Research step exhausted retries",
      resumedFromRunId: null,
      startedAt: "2026-06-10T11:50:00.000Z",
      completedAt: "2026-06-10T11:52:00.000Z",
      createdAt: "2026-06-10T11:50:00.000Z",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      workflowName: "contentPipeline",
      temporalWorkflowId: "content-done",
      temporalRunId: "r-4",
      status: "completed",
      input: { topic: "Launch recap", keywords: ["launch"], tone: "professional", wordCount: 1000, approverId: "u-1" },
      output: null,
      error: null,
      resumedFromRunId: null,
      startedAt: "2026-06-10T11:40:00.000Z",
      completedAt: "2026-06-10T11:46:00.000Z",
      createdAt: "2026-06-10T11:40:00.000Z",
    },
  ],
  nextCursor: null,
};

async function mockBackend(page: Page) {
  await page.route(`${SERVER}/api/auth/get-session`, (route) =>
    route.fulfill({
      json: {
        user: { id: "u-1", email: "demo@conductor.dev", name: "Demo Operator", emailVerified: true },
        session: { id: "s-1", userId: "u-1", activeOrganizationId: "org_test" },
      },
    }),
  );
  await page.route(`${SERVER}/api/auth/organization/list`, (route) =>
    route.fulfill({ json: [{ id: "org_test", name: "Acme Content", slug: "acme" }] }),
  );
  await page.route(`${SERVER}/api/auth/token`, (route) =>
    route.fulfill({ json: { token: "test.jwt.token" } }),
  );
  await page.route(`${SERVER}/runs**`, (route) => route.fulfill({ json: RUNS_FIXTURE }));
  // Onboarding checklist data (Unit 23) — everything complete, so the
  // checklist hides itself and the snapshot stays the pure dashboard.
  await page.route(`${SERVER}/orgs/api-key`, (route) =>
    route.fulfill({ json: { configured: true, last4: "0000" } }),
  );
  await page.route(`${SERVER}/api/auth/organization/get-full-organization*`, (route) =>
    route.fulfill({
      json: {
        id: "org_test",
        name: "Acme Content",
        slug: "acme",
        createdAt: "2026-06-01T00:00:00.000Z",
        members: [
          {
            id: "m-1",
            organizationId: "org_test",
            userId: "u-1",
            role: "owner",
            createdAt: "2026-06-01T00:00:00.000Z",
            user: { id: "u-1", name: "Demo Operator", email: "demo@conductor.dev" },
          },
          {
            id: "m-2",
            organizationId: "org_test",
            userId: "u-2",
            role: "member",
            createdAt: "2026-06-01T00:00:00.000Z",
            user: { id: "u-2", name: "Reviewer", email: "reviewer@conductor.dev" },
          },
        ],
        invitations: [],
      },
    }),
  );
}

test("populated run dashboard sorts attention-first", async ({ page }) => {
  // Freeze time so relative timestamps + live durations render deterministically.
  // setFixedTime (not install): install's clock keeps advancing in real time,
  // so the ticking duration cells drifted a second between runs (flaky diffs).
  await page.clock.setFixedTime(new Date("2026-06-10T12:00:00.000Z"));
  await page.addInitScript(
    (arg: { key: string; token: string }) =>
      window.localStorage.setItem(arg.key, arg.token),
    { key: SESSION_TOKEN_KEY, token: "test-session-token" },
  );
  await mockBackend(page);

  await page.goto("/runs");

  // Suspended/failed must rank above running, which ranks above completed.
  const rows = page.locator('a[href^="/runs/"]');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("Suspended");
  await expect(rows.nth(1)).toContainText("Failed");
  await expect(rows.nth(2)).toContainText("Running");
  await expect(rows.nth(3)).toContainText("Completed");

  await expect(page).toHaveScreenshot("runs-dashboard-populated.png", { fullPage: true });
});
