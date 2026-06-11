import { test, expect, type Page } from "@playwright/test";

/**
 * Unit 30 — canvas viewer smoke (mocked backend, same pattern as the dashboard
 * snapshot spec, but assertion-based: no pixel baseline, so it runs anywhere).
 * Proves the two new pages render their populated states without console
 * errors: the template pipeline at /workflows/[key] and a run's pinned spec at
 * /runs/[id]/pipeline with live status tinting.
 */

const SERVER = "http://localhost:4100";
const SESSION_TOKEN_KEY = "conductor.session-token";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const DEFINITION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const BLOG_SPEC = {
  specVersion: 1,
  name: "Blog Post Pipeline",
  nodes: [
    { id: "research", type: "research", config: {} },
    { id: "approval", type: "approval", config: {} },
    { id: "write", type: "write", config: {} },
    { id: "publish", type: "publish", config: {} },
  ],
  edges: [
    { from: "research", to: "approval" },
    { from: "approval", to: "write" },
    { from: "write", to: "publish" },
  ],
};

const RUN_DETAIL_FIXTURE = {
  run: {
    id: RUN_ID,
    workflowName: "Blog Post Pipeline",
    temporalWorkflowId: `run-${RUN_ID}`,
    temporalRunId: "r-1",
    status: "suspended",
    input: {
      topic: "Durable AI workflows",
      keywords: ["temporal"],
      tone: "technical",
      wordCount: 1200,
      approverId: "u-1",
    },
    output: null,
    error: null,
    resumedFromRunId: null,
    definitionId: DEFINITION_ID,
    startedAt: "2026-06-10T11:59:00.000Z",
    completedAt: null,
    createdAt: "2026-06-10T11:59:00.000Z",
  },
  steps: [
    {
      id: "21111111-1111-4111-8111-111111111111",
      stepKind: "research",
      status: "completed",
      attempt: 1,
      input: null,
      output: { summary: "findings" },
      error: null,
      startedAt: "2026-06-10T11:59:01.000Z",
      completedAt: "2026-06-10T11:59:30.000Z",
    },
  ],
};

const DEFINITION_FIXTURE = {
  id: DEFINITION_ID,
  name: "Blog Post Pipeline",
  description: null,
  version: 3,
  graphSpec: BLOG_SPEC,
  templateKey: "blog-post-pipeline",
  createdAt: "2026-06-01T00:00:00.000Z",
};

const TEMPLATES_FIXTURE = {
  items: [
    {
      key: "blog-post-pipeline",
      name: "Blog Post Pipeline",
      description: "research → approval → write → publish.",
      definitionId: DEFINITION_ID,
      version: 3,
    },
    {
      key: "seo-brief",
      name: "SEO Brief",
      description: "seo",
      definitionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      version: 1,
    },
    {
      key: "competitor-research",
      name: "Competitor Research",
      description: "competitors",
      definitionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      version: 1,
    },
  ],
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
  await page.route(`${SERVER}/api/auth/organization/get-full-organization*`, (route) =>
    route.fulfill({
      json: {
        id: "org_test",
        name: "Acme Content",
        slug: "acme",
        createdAt: "2026-06-01T00:00:00.000Z",
        members: [],
        invitations: [],
      },
    }),
  );
  await page.route(`${SERVER}/api/auth/token`, (route) =>
    route.fulfill({ json: { token: "test.jwt.token" } }),
  );
  await page.route(`${SERVER}/templates`, (route) =>
    route.fulfill({ json: TEMPLATES_FIXTURE }),
  );
  await page.route(`${SERVER}/runs/${RUN_ID}`, (route) =>
    route.fulfill({ json: RUN_DETAIL_FIXTURE }),
  );
  await page.route(`${SERVER}/definitions/${DEFINITION_ID}`, (route) =>
    route.fulfill({ json: DEFINITION_FIXTURE }),
  );
  await page.route(`${SERVER}/approvals**`, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

/** Socket.IO is unmocked, so its connection failures are expected noise. */
function realErrors(errors: string[]): string[] {
  return errors.filter(
    (text) => !text.includes("/ws") && !text.toLowerCase().includes("websocket"),
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (arg: { key: string; token: string }) =>
      window.localStorage.setItem(arg.key, arg.token),
    { key: SESSION_TOKEN_KEY, token: "test-session-token" },
  );
  await mockBackend(page);
});

test("template pipeline page renders the spec canvas and launch form", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto("/workflows/blog-post-pipeline");

  // All four chain nodes on the canvas, with config + channel labels.
  for (const id of ["research", "approval", "write", "publish"]) {
    await expect(page.getByText(id, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("24h approval window")).toBeVisible();
  await expect(page.getByText("120s timeout · 5 attempts").first()).toBeVisible();

  await expect(page.getByText("Launch this pipeline")).toBeVisible();
  await expect(page.getByText("About this pipeline")).toBeVisible();
  await expect(page.getByText("v3").first()).toBeVisible();

  expect(realErrors(errors)).toEqual([]);
});

test("unknown template key shows the tailored not-found state", async ({ page }) => {
  await page.goto("/workflows/not-a-template");
  await expect(page.getByText(/couldn't find that workflow template/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to workflows" })).toBeVisible();
});

test("run pipeline page renders the pinned spec with live statuses", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto(`/runs/${RUN_ID}/pipeline`);

  await expect(page.getByText("pinned v3")).toBeVisible();
  for (const id of ["research", "approval", "write", "publish"]) {
    await expect(page.getByText(id, { exact: true })).toBeVisible();
  }
  // The run is suspended at the gate — the breadcrumb badge says so.
  await expect(page.getByText("Suspended")).toBeVisible();

  expect(realErrors(errors)).toEqual([]);
});

test("run detail links to its pinned pipeline view", async ({ page }) => {
  await page.goto(`/runs/${RUN_ID}`);
  const link = page.getByRole("link", { name: /view pipeline/i });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", `/runs/${RUN_ID}/pipeline`);
});
