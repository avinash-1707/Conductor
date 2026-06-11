import { test, expect } from "@playwright/test";

/**
 * The golden path (Unit 23, success criterion #7): a brand-new account
 * reaches a completed run by following only the onboarding checklist —
 * sign up → name org → add key (stub) → skip invite → configure → launch →
 * watch the mock model stream live → approve → completed. Real server,
 * worker, Postgres, Redis, Temporal, and Socket.IO; only the model is canned
 * (`LLM_MODE=mock`). Requires docker infra up.
 */

test("golden path: sign up → checklist → launch → stream → approve → completed", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = Date.now();

  // 1. Sign up — straight into naming the organization.
  await page.goto("/signup");
  await page.fill("#name", "Golden Path");
  await page.fill("#email", `golden-${stamp}@e2e.dev`);
  await page.fill("#password", "password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/create-org");

  await page.fill("#org-name", `Golden Org ${stamp}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await page.waitForURL("**/runs");

  // 2. The checklist greets the new account; the org step is already done.
  await expect(page.getByText("Get set up")).toBeVisible();
  await expect(page.getByText("Name your organization")).toBeVisible();

  // 3. Add the stub OpenRouter key via the checklist deep link.
  await page.getByRole("link", { name: "Add your OpenRouter API key" }).click();
  await page.waitForURL("**/settings");
  await page.fill("#openrouter-key", `sk-or-e2e-stub-${stamp}`);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText(/Configured · ····/)).toBeVisible();

  // 4. Back on the dashboard, skip the approver invite (any member can approve).
  await page.getByRole("link", { name: "Runs", exact: true }).click();
  await page.waitForURL("**/runs");
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByText("Skipped")).toBeVisible();

  // 5. Configure and launch the first pipeline from the Workflow Library —
  // the template card (pinned version chip) with its schema-generated form
  // (Unit 26); the first template's form is open by default.
  await page.getByRole("link", { name: "Run your first pipeline" }).click();
  await page.waitForURL("**/workflows");
  await expect(page.getByText("Blog Post Pipeline")).toBeVisible();
  await expect(page.getByText(/^v\d+$/)).toBeVisible();
  await page.fill("#topic", "Durable AI pipelines for agencies");
  await page.fill("#keywords", "temporal, reliability");
  await page.selectOption("#tone", "technical");
  await page.fill("#wordCount", "300");
  await page.getByRole("button", { name: "Launch run" }).click();

  // 6. Run Detail goes live: the mock model's research summary streams in
  // token by token (the first "aha"), then the gate suspends the run.
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/);
  const runUrl = page.url();
  await expect(page.getByText("Mock research synthesis for").first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("Suspended").first()).toBeVisible({ timeout: 60_000 });

  // 7. Approve from the queue (deep-linkable, badge counts pending).
  await page.getByRole("link", { name: /Approvals/ }).click();
  await page.waitForURL("**/approvals");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();

  // 8. The run resumes within seconds, writes, publishes, and completes.
  await page.goto(runUrl);
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 90_000 });

  // 9. Everything done — the checklist has left the dashboard.
  await page.goto("/runs");
  await expect(page.locator('a[href^="/runs/"]').first()).toBeVisible();
  await expect(page.getByText("Get set up")).not.toBeVisible();
});
