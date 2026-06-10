import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
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
 * Run lifecycle API tests (Unit 13) — real Better Auth + Postgres, mocked
 * Temporal starter. Covers the happy paths, validation, auth, tenancy 404s,
 * and pagination cursor correctness. Requires local Postgres with all
 * migrations applied.
 */
const checks = {
  postgres: async () => true,
  redis: async () => true,
  temporal: async () => true,
};

const starter: RunGateway = {
  startContentPipeline: vi.fn(),
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
  vi.mocked(starter.startContentPipeline).mockReset();
  vi.mocked(starter.startContentPipeline).mockResolvedValue({
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

async function startRun(jwt: string): Promise<RunResource> {
  const res = await app.inject({
    method: "POST",
    url: "/runs",
    headers: { authorization: `Bearer ${jwt}` },
    payload: params,
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
    expect(starter.startContentPipeline).toHaveBeenCalledWith({
      workflowId: `run-${run.id}`,
      input: { ...params, orgId },
    });

    const stored = await repos.runs.findRunById({ orgId, id: run.id });
    expect(stored?.status).toBe("pending");
  });

  it("takes the org from the verified claims, never the body", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { ...params, orgId: "org_attacker" },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(starter.startContentPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ orgId }) }),
    );
  });

  it("400s invalid launch parameters", async () => {
    const { jwt } = await signUpOwner(app);
    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { ...params, wordCount: 7 },
    });
    expect(res.statusCode).toBe(400);
    expect(starter.startContentPipeline).not.toHaveBeenCalled();
  });

  it("401s an unauthenticated request and 403s without an active org", async () => {
    const unauth = await app.inject({ method: "POST", url: "/runs", payload: params });
    expect(unauth.statusCode).toBe(401);

    const { jwt } = await signUp(app);
    const noOrg = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { authorization: `Bearer ${jwt}` },
      payload: params,
    });
    expect(noOrg.statusCode).toBe(403);
  });

  it("marks the run failed and returns 502 when the workflow start fails", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    vi.mocked(starter.startContentPipeline).mockRejectedValue(
      new Error("temporal unreachable"),
    );

    const res = await app.inject({
      method: "POST",
      url: "/runs",
      headers: { authorization: `Bearer ${jwt}` },
      payload: params,
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
