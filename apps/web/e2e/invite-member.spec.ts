import { test, expect } from "@playwright/test";

/**
 * Invite → accept → member is in the org (Unit 27). Real server + Postgres;
 * no worker needed (nothing executes). The owner invites from /settings,
 * copies the accept link (the same URL the invitation email carries), and a
 * fresh browser context signs up as the invitee through that link. Asserts
 * the membership AND the non-owner gating (owner-only controls disabled).
 */

test("invite → accept link → new member joins and sees gated settings", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const inviteeEmail = `invitee-${stamp}@e2e.dev`;

  // --- Owner: sign up, create the org, invite the reviewer. ---
  const ownerContext = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const owner = await ownerContext.newPage();
  await owner.goto("/signup");
  await owner.fill("#name", "Org Owner");
  await owner.fill("#email", `owner-${stamp}@e2e.dev`);
  await owner.fill("#password", "password-123");
  await owner.getByRole("button", { name: "Create account" }).click();
  await owner.waitForURL("**/create-org");
  await owner.fill("#org-name", `Invite Org ${stamp}`);
  await owner.getByRole("button", { name: "Create organization" }).click();
  await owner.waitForURL("**/runs");

  await owner.goto("/settings");
  await owner.fill("#invite-email", inviteeEmail);
  await owner.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(owner.getByText(inviteeEmail)).toBeVisible();
  await expect(owner.getByText("invited", { exact: true })).toBeVisible();

  // The copyable accept link is the canonical invitation URL.
  await owner.getByRole("button", { name: `Copy invite link for ${inviteeEmail}` }).click();
  await expect(owner.getByText("Link copied")).toBeVisible();
  const acceptUrl = await owner.evaluate(() => navigator.clipboard.readText());
  expect(acceptUrl).toMatch(/\/accept-invitation\/[A-Za-z0-9-]+$/);

  // --- Invitee: fresh context, lands on the link, detours through signup. ---
  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();
  await invitee.goto(acceptUrl);
  await invitee.waitForURL("**/login?next=**");
  await invitee.getByRole("link", { name: "Create an account" }).click();
  await invitee.waitForURL("**/signup?next=**");
  await invitee.fill("#name", "Invited Reviewer");
  await invitee.fill("#email", inviteeEmail);
  await invitee.fill("#password", "password-123");
  await invitee.getByRole("button", { name: "Create account" }).click();

  // The `next` param brings them back; the page accepts and lands on /runs
  // with the org active (never via /create-org).
  await invitee.waitForURL("**/runs", { timeout: 30_000 });

  // --- Member view: in the org, gated settings, approvals reachable. ---
  await invitee.goto("/settings");
  await expect(invitee.getByText("Org Owner")).toBeVisible();
  await expect(invitee.getByText("Invited Reviewer")).toBeVisible();
  // Non-owner sees owner-only controls disabled (build-plan Verify line).
  await expect(invitee.getByText("Owner only").first()).toBeVisible();
  await expect(invitee.locator("#invite-email")).toBeDisabled();
  await expect(invitee.locator("#openrouter-key")).toBeDisabled();
  await expect(invitee.locator("#org-name")).toBeDisabled();

  // Any member can approve — the queue is theirs (decision authority is
  // proven by the Unit 14 route tests; here it just has nothing pending).
  await invitee.goto("/approvals");
  await expect(invitee.getByText("Nothing is waiting on you", { exact: false })).toBeVisible();

  // --- Owner sees the new member (and no more pending invitation). ---
  await owner.reload();
  await expect(owner.getByText("Invited Reviewer")).toBeVisible();
  await expect(owner.getByText("invited", { exact: true })).not.toBeVisible();

  await ownerContext.close();
  await inviteeContext.close();
});
