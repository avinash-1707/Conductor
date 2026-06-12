import { test, expect } from "@playwright/test";

/**
 * The canvas path (Unit 32, build-plan verify line): a three-node workflow
 * drawn from scratch on the canvas executes end-to-end via the interpreter —
 * draw research → approval → write, save it as v1, launch it with engine
 * params, approve at the gate, and watch it complete (a chain without publish
 * is a valid degenerate spec; the run completes with no deliverable step).
 * Real server, worker, Postgres, Redis, Temporal; `LLM_MODE=mock`.
 */

test("canvas path: draw → save v1 → launch → approve → completed", async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = Date.now();

  // 1. Fresh account + org + stub key (the worker decrypts it for real).
  await page.goto("/signup");
  await page.fill("#name", "Canvas Author");
  await page.fill("#email", `canvas-${stamp}@e2e.dev`);
  await page.fill("#password", "password-123");
  await page.fill("#confirm-password", "password-123");
  await page.check("input[type=checkbox]");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/create-org");
  await page.fill("#org-name", `Canvas Org ${stamp}`);
  await page.getByRole("button", { name: "Create organization" }).click();
  await page.waitForURL("**/runs");
  await page.getByRole("link", { name: "Add your OpenRouter API key" }).click();
  await page.waitForURL("**/settings");
  await page.fill("#openrouter-key", `sk-or-e2e-stub-${stamp}`);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByText(/Configured · ····/)).toBeVisible();

  // 2. Draw the three-node chain on the canvas (click-to-add auto-chains).
  await page.getByRole("link", { name: "Canvas", exact: true }).click();
  await page.waitForURL("**/canvas");
  await page.getByLabel("Workflow name").fill(`Digest ${stamp}`);
  for (const type of ["research", "approval", "write"]) {
    await page
      .getByTitle(`Add ${type} (drag onto the canvas, or click to append)`)
      .click();
  }
  await expect(page.getByText("Valid pipeline")).toBeVisible();

  // 3. Save as v1 — the toolbar flips to the saved state and Launch arms.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Both the toolbar button and the toast read "Saved v1".
  await expect(page.getByText("Saved v1").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Launch/ })).toBeEnabled();
  // Version history appears for the open definition.
  await expect(page.getByRole("heading", { name: "Versions" })).toBeVisible();
  await expect(page.getByText("v1", { exact: true })).toBeVisible();

  // 4. Launch with engine params from the modal.
  await page.getByRole("button", { name: /Launch/ }).click();
  await page.fill("#topic", "Weekly research digest");
  await page.fill("#keywords", "ai, agencies");
  await page.selectOption("#tone", "technical");
  await page.fill("#wordCount", "300");
  await page.getByRole("button", { name: "Launch run" }).click();

  // 5. Run Detail live: the drawn workflow's name, streaming research, the gate.
  await page.waitForURL(/\/runs\/[0-9a-f-]{36}$/);
  const runUrl = page.url();
  await expect(page.getByText(`Digest ${stamp}`).first()).toBeVisible();
  await expect(page.getByText("Suspended").first()).toBeVisible({ timeout: 60_000 });

  // 6. The pinned pipeline view shows the drawn three-node spec.
  await page.getByRole("link", { name: /view pipeline/i }).click();
  await page.waitForURL(/\/pipeline$/);
  await expect(page.getByText("pinned v1")).toBeVisible();
  for (const id of ["research", "approval", "write"]) {
    await expect(page.getByText(id, { exact: true })).toBeVisible();
  }

  // 7. Approve → the interpreter resumes, writes, and completes the run.
  await page.getByRole("link", { name: /Approvals/ }).click();
  await page.waitForURL("**/approvals");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();
  await page.goto(runUrl);
  await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 90_000 });
});
