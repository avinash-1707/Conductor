import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import {
  blogPostPipelineSpec,
  graphSpecSchema,
  type BlogPostPipelineInput,
  type GraphSpec,
} from "@conductor/shared";
import { organization } from "@conductor/db";
import { db, pool } from "../db/client";
import { repos } from "./index";
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
    expect(
      (await runsRepo.listRuns({ orgId: orgB, limit: 100 })).items.some(
        (r) => r.id === run.id,
      ),
    ).toBe(false);
  });

  it("ensureRunStarted is idempotent and converges on a pre-created row", async () => {
    const temporalWorkflowId = `content-${randomUUID()}`;
    const preCreated = await runsRepo.createRun({
      orgId: orgA,
      workflowName: "contentPipeline",
      temporalWorkflowId,
      input: sampleInput,
      status: "pending",
    });

    const first = await repos.runs.ensureRunStarted({
      orgId: orgA,
      temporalWorkflowId,
      temporalRunId: "tr-1",
      workflowName: "contentPipeline",
      input: sampleInput,
    });
    const second = await repos.runs.ensureRunStarted({
      orgId: orgA,
      temporalWorkflowId,
      temporalRunId: "tr-1",
      workflowName: "contentPipeline",
      input: sampleInput,
    });

    expect(first.id).toBe(preCreated.id);
    expect(second.id).toBe(preCreated.id);
    expect(second.status).toBe("running");
    expect(second.startedAt).toEqual(first.startedAt);
  });

  it("markRunTerminal preserves the first completion time across retries", async () => {
    const temporalWorkflowId = `content-${randomUUID()}`;
    await runsRepo.createRun({
      orgId: orgA,
      workflowName: "contentPipeline",
      temporalWorkflowId,
      input: sampleInput,
    });

    const first = await repos.runs.markRunTerminal({
      orgId: orgA,
      temporalWorkflowId,
      status: "failed",
      error: "boom",
    });
    const second = await repos.runs.markRunTerminal({
      orgId: orgA,
      temporalWorkflowId,
      status: "failed",
      error: "boom",
    });
    expect(first?.completedAt).not.toBeNull();
    expect(second?.completedAt).toEqual(first?.completedAt);
    // Cross-org write resolves to no row, never another org's run.
    expect(
      await repos.runs.markRunTerminal({
        orgId: orgB,
        temporalWorkflowId,
        status: "failed",
        error: "boom",
      }),
    ).toBeUndefined();
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
      (await approvalsRepo.listPendingApprovals({ orgId: orgB, limit: 100 })).items.some(
        (a) => a.id === approval.id,
      ),
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

  // Versioning (Unit 24): immutable version rows, auto-incremented per
  // (org, name); pinning means the prior row survives a new version unchanged.
  it("auto-increments versions and preserves prior version rows (pinning)", async () => {
    const name = `Blog Pipeline ${randomUUID().slice(0, 8)}`;
    const v1 = await definitionsRepo.createDefinitionVersion({
      orgId: orgA,
      name,
      graphSpec: blogPostPipelineSpec,
    });
    expect(v1.version).toBe(1);
    expect(v1.graphSpec).toEqual(blogPostPipelineSpec);

    const editedSpec = graphSpecSchema.parse({
      ...blogPostPipelineSpec,
      nodes: blogPostPipelineSpec.nodes.map((n) =>
        n.type === "research" ? { ...n, config: { maximumAttempts: 3 } } : n,
      ),
    });
    const v2 = await definitionsRepo.createDefinitionVersion({
      orgId: orgA,
      name,
      graphSpec: editedSpec,
    });
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);

    // The pinned v1 row is untouched by the v2 insert.
    const v1Again = await definitionsRepo.findDefinitionById({ orgId: orgA, id: v1.id });
    expect(v1Again?.version).toBe(1);
    expect(v1Again?.graphSpec).toEqual(blogPostPipelineSpec);

    expect(
      (await definitionsRepo.findLatestDefinition({ orgId: orgA, name }))?.version,
    ).toBe(2);
    expect(
      (await definitionsRepo.listDefinitionVersions({ orgId: orgA, name })).map(
        (d) => d.version,
      ),
    ).toEqual([2, 1]);
  });

  it("rejects an invalid graph spec at the persistence door", async () => {
    const invalid = {
      ...blogPostPipelineSpec,
      // research → research: a cycle with no entry point.
      edges: [{ from: "research", to: "research" }],
    } as unknown as GraphSpec;
    await expect(
      definitionsRepo.createDefinitionVersion({
        orgId: orgA,
        name: `Broken ${randomUUID().slice(0, 8)}`,
        graphSpec: invalid,
      }),
    ).rejects.toThrow();
  });

  it("scopes version numbering and latest lookup per org", async () => {
    const name = `Shared Name ${randomUUID().slice(0, 8)}`;
    const a1 = await definitionsRepo.createDefinitionVersion({
      orgId: orgA,
      name,
      graphSpec: blogPostPipelineSpec,
    });
    const b1 = await definitionsRepo.createDefinitionVersion({
      orgId: orgB,
      name,
      graphSpec: blogPostPipelineSpec,
    });
    // Same template name, separate orgs — each starts its own version line.
    expect(a1.version).toBe(1);
    expect(b1.version).toBe(1);

    await definitionsRepo.createDefinitionVersion({
      orgId: orgA,
      name,
      graphSpec: blogPostPipelineSpec,
    });
    expect(
      (await definitionsRepo.findLatestDefinition({ orgId: orgA, name }))?.version,
    ).toBe(2);
    expect(
      (await definitionsRepo.findLatestDefinition({ orgId: orgB, name }))?.version,
    ).toBe(1);
    expect(await definitionsRepo.listDefinitionVersions({ orgId: orgB, name })).toHaveLength(
      1,
    );
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

describe("publish_deliveries ledger", () => {
  it("records a delivery once per (org, key) and returns the original receipt", async () => {
    const idempotencyKey = `content-${randomUUID()}`;
    const receipt = { deliveredAt: "2026-06-10T12:00:00.000Z" };

    const first = await repos.publishDeliveries.recordDelivery({
      orgId: orgA,
      idempotencyKey,
      receipt,
    });
    const second = await repos.publishDeliveries.recordDelivery({
      orgId: orgA,
      idempotencyKey,
      receipt: { deliveredAt: "2026-06-10T13:00:00.000Z" },
    });

    expect(second.id).toBe(first.id);
    expect(second.receipt).toEqual(receipt);
  });

  it("scopes the ledger per org — the same key in two orgs is two deliveries", async () => {
    const idempotencyKey = `content-${randomUUID()}`;
    const receipt = { deliveredAt: "2026-06-10T12:00:00.000Z" };

    const a = await repos.publishDeliveries.recordDelivery({
      orgId: orgA,
      idempotencyKey,
      receipt,
    });
    const b = await repos.publishDeliveries.recordDelivery({
      orgId: orgB,
      idempotencyKey,
      receipt,
    });
    expect(a.id).not.toBe(b.id);

    expect(
      (await repos.publishDeliveries.findDelivery({ orgId: orgA, idempotencyKey }))?.id,
    ).toBe(a.id);
    expect(
      (await repos.publishDeliveries.findDelivery({ orgId: orgB, idempotencyKey }))?.id,
    ).toBe(b.id);
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
