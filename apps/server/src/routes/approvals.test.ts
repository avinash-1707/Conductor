import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { WorkflowNotFoundError } from "@temporalio/client";
import {
  approvalListResponseSchema,
  approvalResourceSchema,
  approvalSignalPayloadSchema,
  type ApprovalContext,
} from "@conductor/shared";
import { buildApp } from "../app";
import { auth } from "../auth/auth";
import { repos } from "../repos/index";
import type { RunGateway } from "../temporal";
import { signUp, signUpOwner } from "../test-utils/auth";

/**
 * Approval flow API tests (Unit 14) — real Better Auth + Postgres, mocked
 * Temporal gateway. Covers the queue, decisions (signal payload + atomic
 * claim), conflicts, and tenancy. Requires local Postgres with all migrations
 * applied.
 */
const checks = {
  postgres: async () => true,
  redis: async () => true,
  temporal: async () => true,
};

const gateway: RunGateway = {
  startContentPipeline: vi.fn(),
  signalApprovalDecision: vi.fn(),
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ checks, auth, temporal: gateway });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.mocked(gateway.signalApprovalDecision).mockReset();
  vi.mocked(gateway.signalApprovalDecision).mockResolvedValue(undefined);
});

const CONTEXT: ApprovalContext = {
  research: {
    summary: "Findings summary.",
    sources: [{ title: "Src", url: "https://example.com", takeaway: "Useful." }],
    keyPoints: ["Point one"],
  },
};

/** Seeds a suspended run with a pending approval directly through the repos. */
async function seedPendingApproval(orgId: string) {
  const run = await repos.runs.createRun({
    orgId,
    workflowName: "contentPipeline",
    temporalWorkflowId: `run-${crypto.randomUUID()}`,
    status: "suspended",
    input: {
      topic: "Durable AI pipelines",
      keywords: ["temporal"],
      tone: "technical",
      wordCount: 800,
      approverId: "user_approver",
    },
  });
  const approval = await repos.approvals.upsertApprovalForRun({
    orgId,
    runId: run.id,
    context: CONTEXT,
  });
  return { run, approval };
}

function jwtSubject(jwt: string): string {
  const payload = JSON.parse(
    Buffer.from(jwt.split(".")[1]!, "base64url").toString("utf8"),
  ) as { sub?: string; id?: string };
  return (payload.id ?? payload.sub)!;
}

describe("GET /approvals", () => {
  it("lists only the org's pending approvals, paginated newest-first", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const a = await seedPendingApproval(orgId);
    const b = await seedPendingApproval(orgId);
    const c = await seedPendingApproval(orgId);

    const page1 = await app.inject({
      method: "GET",
      url: "/approvals?limit=2",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(page1.statusCode, page1.body).toBe(200);
    const body1 = approvalListResponseSchema.parse(page1.json());
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();

    const page2 = await app.inject({
      method: "GET",
      url: `/approvals?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const body2 = approvalListResponseSchema.parse(page2.json());
    expect(body2.items).toHaveLength(1);
    expect(body2.nextCursor).toBeNull();

    const ids = [...body1.items, ...body2.items].map((i) => i.id);
    expect(new Set(ids)).toEqual(new Set([a.approval.id, b.approval.id, c.approval.id]));
  });

  it("excludes decided approvals and other orgs' queues", async () => {
    const a = await signUpOwner(app);
    const b = await signUpOwner(app);
    const seeded = await seedPendingApproval(a.orgId);
    await repos.approvals.claimDecision({
      orgId: a.orgId,
      id: seeded.approval.id,
      decision: "approved",
      reviewerId: "user_x",
      decidedAt: new Date(),
    });

    for (const jwt of [a.jwt, b.jwt]) {
      const res = await app.inject({
        method: "GET",
        url: "/approvals",
        headers: { authorization: `Bearer ${jwt}` },
      });
      const body = approvalListResponseSchema.parse(res.json());
      expect(body.items.some((i) => i.id === seeded.approval.id)).toBe(false);
    }
  });

  it("401s an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/approvals" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /approvals/:id/approve", () => {
  it("signals the workflow then records decision, decider, and timestamp", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const { run, approval } = await seedPendingApproval(orgId);

    const res = await app.inject({
      method: "POST",
      url: `/approvals/${approval.id}/approve`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = approvalResourceSchema.parse(res.json());
    expect(body.status).toBe("approved");
    expect(body.reviewerId).toBe(jwtSubject(jwt));
    expect(body.decidedAt).not.toBeNull();

    expect(gateway.signalApprovalDecision).toHaveBeenCalledTimes(1);
    const call = vi.mocked(gateway.signalApprovalDecision).mock.calls[0]![0];
    expect(call.temporalWorkflowId).toBe(run.temporalWorkflowId);
    const payload = approvalSignalPayloadSchema.parse(call.payload);
    expect(payload.decision).toBe("approved");
    expect(payload.reviewerId).toBe(jwtSubject(jwt));
  });

  it("409s the second decision and signals only once", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const { approval } = await seedPendingApproval(orgId);

    const first = await app.inject({
      method: "POST",
      url: `/approvals/${approval.id}/approve`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: `/approvals/${approval.id}/reject`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe(
      "approval_already_decided",
    );
    expect(gateway.signalApprovalDecision).toHaveBeenCalledTimes(1);
  });

  it("502s and leaves the approval pending when the signal fails", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const { approval } = await seedPendingApproval(orgId);
    vi.mocked(gateway.signalApprovalDecision).mockRejectedValue(
      new Error("temporal unreachable"),
    );

    const res = await app.inject({
      method: "POST",
      url: `/approvals/${approval.id}/approve`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "approval_signal_failed",
    );
    expect(res.body).not.toContain("temporal unreachable");

    const row = await repos.approvals.findApprovalById({ orgId, id: approval.id });
    expect(row?.status).toBe("pending");
  });

  it("409s approval_not_active when the run already closed", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const { approval } = await seedPendingApproval(orgId);
    vi.mocked(gateway.signalApprovalDecision).mockRejectedValue(
      new WorkflowNotFoundError("not found", "wf", undefined),
    );

    const res = await app.inject({
      method: "POST",
      url: `/approvals/${approval.id}/approve`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "approval_not_active",
    );
  });

  it("404s cross-org, unknown, and non-uuid ids alike", async () => {
    const a = await signUpOwner(app);
    const b = await signUpOwner(app);
    const { approval } = await seedPendingApproval(a.orgId);

    for (const id of [
      approval.id, // cross-org (as org B)
      "0c8e7a1e-9999-4999-8999-999999999999",
      "not-a-uuid",
    ]) {
      const res = await app.inject({
        method: "POST",
        url: `/approvals/${id}/approve`,
        headers: { authorization: `Bearer ${b.jwt}` },
      });
      expect(res.statusCode, id).toBe(404);
    }
    expect(gateway.signalApprovalDecision).not.toHaveBeenCalled();
  });

  it("401s unauthenticated and 403s without an active org", async () => {
    const { approval } = await seedPendingApproval((await signUpOwner(app)).orgId);

    const unauth = await app.inject({
      method: "POST",
      url: `/approvals/${approval.id}/approve`,
    });
    expect(unauth.statusCode).toBe(401);

    const { jwt } = await signUp(app);
    const noOrg = await app.inject({
      method: "POST",
      url: `/approvals/${approval.id}/approve`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(noOrg.statusCode).toBe(403);
  });
});

describe("POST /approvals/:id/reject", () => {
  it("records the rejection with the reviewer", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const { approval } = await seedPendingApproval(orgId);

    const res = await app.inject({
      method: "POST",
      url: `/approvals/${approval.id}/reject`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = approvalResourceSchema.parse(res.json());
    expect(body.status).toBe("rejected");
    expect(body.reviewerId).toBe(jwtSubject(jwt));

    const payload = vi.mocked(gateway.signalApprovalDecision).mock.calls[0]![0]
      .payload;
    expect(payload.decision).toBe("rejected");
  });
});
