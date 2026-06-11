import { test, expect, type Page } from "@playwright/test";

/**
 * Unit 31 — canvas editor (mocked backend, assertion-based; the page itself is
 * client-local in this unit). Proves the palette's click-to-add auto-chains a
 * valid pipeline, the shared schema narrates breakage inline (the server's
 * exact validator), and per-node config edits land on the node card.
 */

const SERVER = "http://localhost:4100";
const SESSION_TOKEN_KEY = "conductor.session-token";

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
  await page.route(`${SERVER}/approvals**`, (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
}

function paletteButton(page: Page, type: string) {
  return page.getByTitle(`Add ${type} (drag onto the canvas, or click to append)`);
}

function canvasNode(page: Page, id: string) {
  return page.locator(".react-flow__node", {
    has: page.getByText(id, { exact: true }),
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    (arg: { key: string; token: string }) =>
      window.localStorage.setItem(arg.key, arg.token),
    { key: SESSION_TOKEN_KEY, token: "test-session-token" },
  );
  await mockBackend(page);
  await page.goto("/canvas");
});

test("click-to-add chains a valid pipeline; breaking it flags precise issues inline", async ({ page }) => {
  // Empty state: invitation + the one starter issue in the chip.
  await expect(page.getByText("Drag steps from the palette")).toBeVisible();
  await expect(page.getByText("1 issue", { exact: true })).toBeVisible();

  await page.getByLabel("Workflow name").fill("Research Digest");
  for (const type of ["research", "approval", "write", "publish"]) {
    await paletteButton(page, type).click();
    await expect(canvasNode(page, type)).toBeVisible();
  }
  await expect(page.getByText("Valid pipeline")).toBeVisible();

  // Remove research via the config panel — the chain now consumes a channel
  // nothing produces; the shared schema narrates it inline.
  await canvasNode(page, "research").click();
  await page.getByRole("button", { name: "Remove step" }).click();
  await expect(page.getByText(/consumes "research", which no earlier node produces/).first()).toBeVisible();
  await expect(page.getByText(/issues?$/).first()).toBeVisible();

  // Clicking an issue selects the offending node (config panel opens on it).
  await page
    .getByText(/consumes "research", which no earlier node produces/)
    .first()
    .click();
  await expect(page.getByText("Configure step")).toBeVisible();
});

test("a blank name is flagged and fixing it restores the valid chip", async ({ page }) => {
  for (const type of ["research", "approval", "write", "publish"]) {
    await paletteButton(page, type).click();
  }
  await expect(page.getByText("Name your workflow (1–100 characters).")).toBeVisible();
  await page.getByLabel("Workflow name").fill("Named Pipeline");
  await expect(page.getByText("Valid pipeline")).toBeVisible();
});

test("config edits land on the node card; bad step ids are rejected inline", async ({ page }) => {
  await page.getByLabel("Workflow name").fill("Gate Tuning");
  for (const type of ["research", "approval", "write", "publish"]) {
    await paletteButton(page, type).click();
  }

  // Configure the gate: 48h window renders on the card in the custom tone.
  await canvasNode(page, "approval").click();
  await expect(page.getByText("Configure step")).toBeVisible();
  await page.getByLabel("Approval window (hours)").fill("48");
  await expect(page.getByText("48h approval window")).toBeVisible();
  await expect(page.getByText("Valid pipeline")).toBeVisible();

  // Step id rules narrate inline and block the commit.
  await page.getByLabel("Step id").fill("Bad ID!");
  await page.getByLabel("Step id").blur();
  await expect(page.getByText("Use a lowercase slug: letters, numbers, dashes.")).toBeVisible();
  await expect(canvasNode(page, "approval")).toBeVisible();

  // A valid rename rewrites the node and its edges — still a valid pipeline.
  await page.getByLabel("Step id").fill("gate");
  await page.getByLabel("Step id").blur();
  await expect(canvasNode(page, "gate")).toBeVisible();
  await expect(page.getByText("Valid pipeline")).toBeVisible();

  // Out-of-range config is committed and flagged by the shared schema.
  await page.getByLabel("Approval window (hours)").fill("500");
  await expect(page.getByText("1 issue", { exact: true })).toBeVisible();
});
