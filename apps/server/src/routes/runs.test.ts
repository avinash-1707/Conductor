import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  blogPostPipelineSpec,
  runSchema,
  runDetailResponseSchema,
  runListResponseSchema,
  type RunListResponse,
  type RunResource,
} from "@conductor/shared";
import { buildApp } from "../app";
import { auth } from "../auth/auth";
import { repos } from "../repos/index";
import type { RunGateway } from "../temporal";
import { signUp, signUpOwner } from "../test-utils/auth";

/**
 * Run lifecycle API tests (Unit 13; template launches since Unit 26) — real
 * Better Auth + Postgres, mocked Temporal gateway. Covers the happy paths,
 * definition pinning, validation, auth, tenancy 404s, and pagination cursor
 * correctness. Requires local Postgres with all migrations applied.
 */
const checks = {
  postgres: async () => true,
  redis: async () => true,
  temporal: async () => true,
};

const starter: RunGateway = {
  startInterpreter: vi.fn(),
  signalApprovalDecision: vi.fn(),
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ checks, auth, temporal: starter });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.mocked(starter.startInterpreter).mockReset();
  vi.mocked(starter.startInterpreter).mockResolvedValue({
    temporalRunId: "tr-test-1",
  });
});

const params = {
  topic: "Durable AI pipelines",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_approver",
};

const launchBody = { templateKey: "blog-post-pipeline", params };

async function startRun(jwt: string): Promise<RunResource> {
  const res = await app.inject({
    method: "POST",
    url: "/runs",
    headers: { authorization: `Bearer ${jwt}` },
    payload: launchBody,
  });
  expect(res.statusCode, res.body).toBe(201);
  return runSchema.parse(res.json());
}

describe("POST /runs", () => {
  it("creates a pending run and starts the workflow with the claim org", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const run = await startRun(jwt);

    expect(run.status).toBe("pending");
    expect(run.temporalWorkflowId).toBe(`run-${run.id}`);
    expect(run.temporalRunId).toBe("tr-test-1");
    expect(run.input).toEqual(params);
    expect(starter.startInterpreter).toHaveBeenCalledWith({
      workflowId: `run-${run.id}`,
      input: {
        orgId,
        templateKey: "blog-post-pipeline",
        spec: blogPostPipelineSpec,
        params,
      },
    });

    const stored = await repos.runs.findRunById({ orgId, id: run.id });
    expect(stored?.status).toBe("pending");
    // The run pins the seeded definition version row (Unit 26).
    expect(stored?.definitionId).toBeTruthy();
    const definition = await repos.definitions.findDefinitionById({
      orgId,
      id: stored!.definitionId!,
    });
    expect(definition?.name).toBe("Blog Post Pipeline");
    expect(definition?.graphSpec).toEqual(blogPostPipelineSpec);
  });

  it("takes the org from the verified claims, never the body", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { ...launchBody, orgId: "org_attacker" },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(starter.startInterpreter).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ orgId }) }),
    );
  });

  it("400s invalid launch parameters", async () => {
    const { jwt } = await signUpOwner(app);
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { templateKey: "blog-post-pipeline", params: { ...params, wordCount: 7 } },
    });
    expect(res.statusCode).toBe(400);
    expect(starter.startInterpreter).not.toHaveBeenCalled();
  });

  it("400s an unknown template key", async () => {
    const { jwt } = await signUpOwner(app);
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { templateKey: "not-a-template", params },
    });
    expect(res.statusCode).toBe(400);
    expect(starter.startInterpreter).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated request and 403s without an active org", async () => {
    const unauth = await app.inject({ method: "POST", url: "/runs", payload: launchBody });
    expect(unauth.statusCode).toBe(401);

    const { jwt } = await signUp(app);
    const noOrg = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { authorization: `Bearer ${jwt}` },
      payload: launchBody,
    });
    expect(noOrg.statusCode).toBe(403);
  });

  it("marks the run failed and returns 502 when the workflow start fails", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    vi.mocked(starter.startInterpreter).mockRejectedValue(
      new Error("temporal unreachable"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { authorization: `Bearer ${jwt}` },
      payload: launchBody,
    });
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "run_start_failed",
    );

    const page = await repos.runs.listRuns({ orgId, limit: 10 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.status).toBe("failed");
    // The internal error is never echoed to the client.
    expect(res.body).not.toContain("temporal unreachable");
  });
});

describe("GET /runs", () => {
  it("paginates newest-first with a correct keyset cursor", async () => {
    const { jwt } = await signUpOwner(app);
    const first = await startRun(jwt);
    const second = await startRun(jwt);
    const third = await startRun(jwt);

    const page1 = await app.inject({
      method: "GET",
      url: "/runs?limit=2",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(page1.statusCode).toBe(200);
    const body1 = runListResponseSchema.parse(page1.json()) as RunListResponse;
    expect(body1.items).toHaveLength(2);
    expect(body1.nextCursor).not.toBeNull();
    expect(body1.items[0]?.id).toBe(third.id);
    expect(body1.items[1]?.id).toBe(second.id);

    const page2 = await app.inject({
      method: "GET",
      url: `/runs?limit=2&cursor=${encodeURIComponent(body1.nextCursor!)}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const body2 = runListResponseSchema.parse(page2.json()) as RunListResponse;
    expect(body2.items).toHaveLength(1);
    expect(body2.items[0]?.id).toBe(first.id);
    expect(body2.nextCursor).toBeNull();

    const ids = [...body1.items, ...body2.items].map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("400s a malformed cursor", async () => {
    const { jwt } = await signUpOwner(app);
    const res = await app.inject({
      method: "GET",
      url: "/runs?cursor=%%%not-a-cursor",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it("scopes the list to the active org", async () => {
    const a = await signUpOwner(app);
    const b = await signUpOwner(app);
    await startRun(a.jwt);

    const res = await app.inject({
      method: "GET",
      url: "/runs",
      headers: { authorization: `Bearer ${b.jwt}` },
    });
    const body = runListResponseSchema.parse(res.json()) as RunListResponse;
    expect(body.items).toHaveLength(0);
  });

  it("401s an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/runs" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /runs/:id", () => {
  it("returns the run with its step projections", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const run = await startRun(jwt);
    await repos.activityLog.startStepAttempt({
      orgId,
      runId: run.id,
      stepKind: "research",
      attempt: 1,
      input: { topic: params.topic },
    });

    const res = await app.inject({
      method: "GET",
      url: `/runs/${run.id}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const detail = runDetailResponseSchema.parse(res.json());
    expect(detail.run.id).toBe(run.id);
    expect(detail.steps).toHaveLength(1);
    expect(detail.steps[0]).toMatchObject({
      stepKind: "research",
      status: "running",
      attempt: 1,
    });
  });

  it("404s a cross-org id, an unknown id, and a non-uuid id alike", async () => {
    const a = await signUpOwner(app);
    const b = await signUpOwner(app);
    const run = await startRun(a.jwt);

    for (const url of [
      `/runs/${run.id}`, // cross-org (as org B)
      "/runs/0c8e7a1e-9999-4999-8999-999999999999", // unknown
      "/runs/not-a-uuid", // non-uuid
    ]) {
      const res = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${b.jwt}` },
      });
      expect(res.statusCode, url).toBe(404);
    }
  });
});

describe("POST /runs/:id/resume", () => {
  const findings = {
    summary: "Prior research summary.",
    sources: [
      { title: "Source", url: "https://example.com/a", takeaway: "Takeaway." },
    ],
    keyPoints: ["Key point"],
  };
  const draft = { title: "Draft", markdown: "# Draft", wordCount: 900 };

  /** Seeds a failed run the way the worker would have left it. */
  async function seedFailedRun(
    jwt: string,
    orgId: string,
    opts: {
      researchCompleted?: boolean;
      writeCompleted?: boolean;
      approved?: boolean;
    } = {},
  ): Promise<RunResource> {
    const run = await startRun(jwt);
    if (opts.researchCompleted) {
      await repos.activityLog.upsertStep({
        orgId,
        runId: run.id,
        stepKind: "research",
        status: "completed",
        attempt: 2,
        input: { topic: params.topic },
        output: findings,
        startedAt: new Date("2026-06-10T12:00:00.000Z"),
        completedAt: new Date("2026-06-10T12:01:00.000Z"),
      });
      const approval = await repos.approvals.upsertApprovalForRun({
        orgId,
        runId: run.id,
        context: { research: findings },
      });
      if (opts.approved) {
        await repos.approvals.claimDecision({
          orgId,
          id: approval.id,
          decision: "approved",
          reviewerId: "user_reviewer",
          decidedAt: new Date(),
        });
      }
    }
    if (opts.writeCompleted) {
      await repos.activityLog.upsertStep({
        orgId,
        runId: run.id,
        stepKind: "write",
        status: "completed",
        attempt: 1,
        input: { topic: params.topic },
        output: draft,
        startedAt: new Date("2026-06-10T12:02:00.000Z"),
        completedAt: new Date("2026-06-10T12:03:00.000Z"),
      });
    }
    await repos.runs.markRunTerminal({
      orgId,
      temporalWorkflowId: run.temporalWorkflowId,
      status: "failed",
      error: "mock step failure",
    });
    return run;
  }

  async function resume(jwt: string, id: string) {
    return app.inject({
      method: "POST",
      url: `/runs/${id}/resume`,
      headers: { authorization: `Bearer ${jwt}` },
    });
  }

  it("resumes a write failure at write with the carried research", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const prior = await seedFailedRun(jwt, orgId, {
      researchCompleted: true,
      approved: true,
    });

    const res = await resume(jwt, prior.id);
    expect(res.statusCode, res.body).toBe(201);
    const run = runSchema.parse(res.json());
    expect(run.id).not.toBe(prior.id);
    expect(run.status).toBe("pending");
    expect(run.resumedFromRunId).toBe(prior.id);
    expect(run.input).toEqual(params);

    expect(starter.startInterpreter).toHaveBeenLastCalledWith({
      workflowId: `run-${run.id}`,
      input: {
        orgId,
        templateKey: "blog-post-pipeline",
        spec: blogPostPipelineSpec,
        params,
        resumeFrom: { channels: { research: findings }, gateApproved: true },
      },
    });

    // The carried research row is visible on the new run's detail.
    const detail = await app.inject({
      method: "GET",
      url: `/runs/${run.id}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const body = runDetailResponseSchema.parse(detail.json());
    expect(body.run.resumedFromRunId).toBe(prior.id);
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0]).toMatchObject({
      stepKind: "research",
      status: "completed",
      attempt: 2,
      output: findings,
    });
  });

  it("resumes a publish failure at publish carrying research and write", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const prior = await seedFailedRun(jwt, orgId, {
      researchCompleted: true,
      writeCompleted: true,
      approved: true,
    });

    const res = await resume(jwt, prior.id);
    expect(res.statusCode, res.body).toBe(201);
    const run = runSchema.parse(res.json());
    expect(starter.startInterpreter).toHaveBeenLastCalledWith({
      workflowId: `run-${run.id}`,
      input: {
        orgId,
        templateKey: "blog-post-pipeline",
        spec: blogPostPipelineSpec,
        params,
        resumeFrom: {
          channels: { research: findings, draft },
          gateApproved: true,
        },
      },
    });

    const steps = await repos.activityLog.listStepsForRun({ orgId, runId: run.id });
    expect(steps.map((s) => s.stepKind).sort()).toEqual(["research", "write"]);
    expect(steps.every((s) => s.status === "completed")).toBe(true);
  });

  it("re-runs the gate when the prior gate was never approved", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const prior = await seedFailedRun(jwt, orgId, { researchCompleted: true });

    const res = await resume(jwt, prior.id);
    expect(res.statusCode, res.body).toBe(201);
    expect(starter.startInterpreter).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          resumeFrom: { channels: { research: findings }, gateApproved: false },
        }),
      }),
    );
  });

  it("restarts fully (no resumeFrom, still linked) when nothing completed", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const prior = await seedFailedRun(jwt, orgId);

    const res = await resume(jwt, prior.id);
    expect(res.statusCode, res.body).toBe(201);
    const run = runSchema.parse(res.json());
    expect(run.resumedFromRunId).toBe(prior.id);

    const calls = vi.mocked(starter.startInterpreter).mock.calls;
    const lastInput = calls[calls.length - 1]?.[0]?.input;
    expect(lastInput).toEqual({
      orgId,
      templateKey: "blog-post-pipeline",
      spec: blogPostPipelineSpec,
      params,
    });
    expect(lastInput && "resumeFrom" in lastInput).toBe(false);

    const steps = await repos.activityLog.listStepsForRun({ orgId, runId: run.id });
    expect(steps).toHaveLength(0);
  });

  it("409s a run that is not failed", async () => {
    const { jwt } = await signUpOwner(app);
    const pending = await startRun(jwt);
    vi.mocked(starter.startInterpreter).mockClear();

    const res = await resume(jwt, pending.id);
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "run_not_resumable",
    );
    expect(starter.startInterpreter).not.toHaveBeenCalled();
  });

  it("404s a cross-org id, an unknown id, and a non-uuid id alike", async () => {
    const a = await signUpOwner(app);
    const b = await signUpOwner(app);
    const prior = await seedFailedRun(a.jwt, a.orgId, { researchCompleted: true });

    for (const id of [
      prior.id, // cross-org (as org B)
      "0c8e7a1e-9999-4999-8999-999999999999", // unknown
      "not-a-uuid", // non-uuid
    ]) {
      const res = await resume(b.jwt, id);
      expect(res.statusCode, id).toBe(404);
    }
  });

  it("401s an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/runs/0c8e7a1e-9999-4999-8999-999999999999/resume",
    });
    expect(res.statusCode).toBe(401);
  });

  it("marks the new run failed and 502s when the workflow start fails", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const prior = await seedFailedRun(jwt, orgId, {
      researchCompleted: true,
      approved: true,
    });
    vi.mocked(starter.startInterpreter).mockRejectedValue(
      new Error("temporal unreachable"),
    );

    const res = await resume(jwt, prior.id);
    expect(res.statusCode).toBe(502);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      "run_start_failed",
    );
    expect(res.body).not.toContain("temporal unreachable");

    const page = await repos.runs.listRuns({ orgId, limit: 10 });
    const newest = page.items[0];
    expect(newest?.resumedFromRunId).toBe(prior.id);
    expect(newest?.status).toBe("failed");
  });
  it("resumes a legacy pre-template run (no definition) on the catalog blog spec", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    // A pre-Unit-26 row: started by the retired hardcoded workflow, never
    // pinned to a definition version.
    const legacyId = crypto.randomUUID();
    await repos.runs.createRun({
      id: legacyId,
      orgId,
      workflowName: "contentPipeline",
      temporalWorkflowId: `run-${legacyId}`,
      status: "failed",
      input: params,
      error: "mock legacy failure",
    });

    const res = await resume(jwt, legacyId);
    expect(res.statusCode, res.body).toBe(201);
    const run = runSchema.parse(res.json());
    expect(run.resumedFromRunId).toBe(legacyId);
    expect(starter.startInterpreter).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          templateKey: "blog-post-pipeline",
          spec: blogPostPipelineSpec,
          params,
        }),
      }),
    );
  });
});
