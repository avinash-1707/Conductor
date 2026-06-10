import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import type { BlogPostPipelineInput } from "@conductor/shared";
import { db, pool } from "../db/client";
import { organization } from "../db/schema";
import * as runsRepo from "./runs";
import * as activityLogRepo from "./activity-log";
import * as approvalsRepo from "./approvals";
import * as definitionsRepo from "./definitions";
import * as apiKeysRepo from "./api-keys";

/**
 * Tenancy regression harness (architecture invariant 11). Two seeded orgs; every
 * repo's scoped read must return a row for its owning org and `undefined` (or an
 * empty list) for the other org. Requires local Postgres with migration #2
 * applied (mirrors auth.test.ts).
 */
const sampleInput: BlogPostPipelineInput = {
  topic: "Durable AI workflows",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 800,
  approverId: "user_approver",
};

const sampleContext = {
  research: {
    summary: "Findings summary.",
    sources: [{ title: "Src", url: "https://example.com", takeaway: "Useful." }],
    keyPoints: ["Point one"],
  },
};

let orgA: string;
let orgB: string;

async function seedOrg(): Promise<string> {
  const id = `org_${randomUUID()}`;
  await db.insert(organization).values({
    id,
    name: `Org ${id.slice(0, 12)}`,
    slug: `slug-${randomUUID().slice(0, 12)}`,
    createdAt: new Date(),
  });
  return id;
}

beforeAll(async () => {
  orgA = await seedOrg();
  orgB = await seedOrg();
});

afterAll(async () => {
  // ON DELETE CASCADE removes every domain row created under these orgs.
  await db.delete(organization).where(inArray(organization.id, [orgA, orgB]));
  await pool.end();
});

describe("workflow_runs isolation", () => {
  it("scopes findRunById and listRuns to the owning org", async () => {
    const run = await runsRepo.createRun({
      orgId: orgA,
      workflowName: "contentPipeline",
      temporalWorkflowId: `content-${randomUUID()}`,
      input: sampleInput,
    });

    expect((await runsRepo.findRunById({ orgId: orgA, id: run.id }))?.id).toBe(run.id);
    expect(await runsRepo.findRunById({ orgId: orgB, id: run.id })).toBeUndefined();
    expect((await runsRepo.listRuns({ orgId: orgB })).some((r) => r.id === run.id)).toBe(false);
  });
});

describe("approval_requests isolation", () => {
  it("scopes findApprovalById and the pending queue to the owning org", async () => {
    const run = await runsRepo.createRun({
      orgId: orgA,
      workflowName: "contentPipeline",
      temporalWorkflowId: `content-${randomUUID()}`,
      input: sampleInput,
    });
    const approval = await approvalsRepo.createApproval({
      orgId: orgA,
      runId: run.id,
      context: sampleContext,
    });

    expect((await approvalsRepo.findApprovalById({ orgId: orgA, id: approval.id }))?.id).toBe(
      approval.id,
    );
    expect(await approvalsRepo.findApprovalById({ orgId: orgB, id: approval.id })).toBeUndefined();
    expect(
      (await approvalsRepo.listPendingApprovals({ orgId: orgB })).some((a) => a.id === approval.id),
    ).toBe(false);
  });
});

describe("workflow_definitions isolation", () => {
  it("scopes findDefinitionById and listDefinitions to the owning org", async () => {
    const def = await definitionsRepo.createDefinition({
      orgId: orgA,
      name: `Blog Pipeline ${randomUUID().slice(0, 8)}`,
    });

    expect((await definitionsRepo.findDefinitionById({ orgId: orgA, id: def.id }))?.id).toBe(def.id);
    expect(await definitionsRepo.findDefinitionById({ orgId: orgB, id: def.id })).toBeUndefined();
    expect(
      (await definitionsRepo.listDefinitions({ orgId: orgB })).some((d) => d.id === def.id),
    ).toBe(false);
  });
});

describe("activity_log isolation", () => {
  it("scopes listStepsForRun to the owning org", async () => {
    const run = await runsRepo.createRun({
      orgId: orgA,
      workflowName: "contentPipeline",
      temporalWorkflowId: `content-${randomUUID()}`,
      input: sampleInput,
    });
    await activityLogRepo.upsertStep({
      orgId: orgA,
      runId: run.id,
      stepKind: "research",
      status: "completed",
    });

    expect((await activityLogRepo.listStepsForRun({ orgId: orgA, runId: run.id })).length).toBe(1);
    expect((await activityLogRepo.listStepsForRun({ orgId: orgB, runId: run.id })).length).toBe(0);
  });

  it("upserts a step idempotently across attempts", async () => {
    const run = await runsRepo.createRun({
      orgId: orgA,
      workflowName: "contentPipeline",
      temporalWorkflowId: `content-${randomUUID()}`,
      input: sampleInput,
    });
    await activityLogRepo.upsertStep({
      orgId: orgA,
      runId: run.id,
      stepKind: "research",
      status: "retrying",
      attempt: 1,
    });
    await activityLogRepo.upsertStep({
      orgId: orgA,
      runId: run.id,
      stepKind: "research",
      status: "completed",
      attempt: 2,
    });

    const steps = await activityLogRepo.listStepsForRun({ orgId: orgA, runId: run.id });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.attempt).toBe(2);
    expect(steps[0]?.status).toBe("completed");
  });
});

describe("org_api_keys isolation", () => {
  it("scopes findOrgApiKey to the owning org and upserts one row per org", async () => {
    await apiKeysRepo.upsertOrgApiKey({ orgId: orgA, ciphertext: "ct-1", last4: "AAAA" });
    await apiKeysRepo.upsertOrgApiKey({ orgId: orgA, ciphertext: "ct-2", last4: "BBBB" });

    const keyA = await apiKeysRepo.findOrgApiKey({ orgId: orgA });
    expect(keyA?.ciphertext).toBe("ct-2");
    expect(keyA?.last4).toBe("BBBB");
    expect(await apiKeysRepo.findOrgApiKey({ orgId: orgB })).toBeUndefined();
  });
});
