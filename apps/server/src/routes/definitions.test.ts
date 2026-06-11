import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  GRAPH_SPEC_VERSION,
  blogPostPipelineSpec,
  definitionListResponseSchema,
  definitionResourceSchema,
  graphSpecSchema,
  runSchema,
  templateListResponseSchema,
  type GraphSpec,
  type InterpreterInput,
} from "@conductor/shared";
import { buildApp } from "../app";
import { auth } from "../auth/auth";
import { repos } from "../repos/index";
import type { RunGateway } from "../temporal";
import { signUpOwner } from "../test-utils/auth";

/**
 * Definition route tests (Units 30/32) — real Better Auth + Postgres, mocked
 * Temporal gateway. Read side (the canvas viewer's pinned-spec fetch), write
 * side (save-as-new-version with reserved-name guard), listings, and canvas
 * launches — incl. the in-flight-immunity proof (an old version id launches
 * the old spec after a v2 exists).
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
  vi.mocked(starter.startInterpreter).mockResolvedValue({ temporalRunId: "tr-canvas-1" });
});

function drawnSpec(name: string, attempts?: number): GraphSpec {
  return graphSpecSchema.parse({
    specVersion: GRAPH_SPEC_VERSION,
    name,
    nodes: [
      {
        id: "research",
        type: "research",
        ...(attempts ? { config: { maximumAttempts: attempts } } : {}),
      },
      { id: "approval", type: "approval" },
      { id: "write", type: "write" },
    ],
    edges: [
      { from: "research", to: "approval" },
      { from: "approval", to: "write" },
    ],
  });
}

const engineParams = {
  topic: "Durable AI pipelines",
  keywords: ["temporal"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_approver",
};

async function saveDefinition(jwt: string, spec: GraphSpec) {
  const res = await app.inject({
    method: "POST",
    url: "/definitions",
    headers: { authorization: `Bearer ${jwt}` },
    payload: { graphSpec: spec },
  });
  expect(res.statusCode, res.body).toBe(201);
  return definitionResourceSchema.parse(res.json());
}

async function seedBlogDefinition(jwt: string): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: "/templates",
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  const body = templateListResponseSchema.parse(res.json());
  return body.items[0]!.definitionId;
}

describe("GET /definitions/:id", () => {
  it("returns the pinned definition with its parsed spec and template link", async () => {
    const { jwt } = await signUpOwner(app);
    const definitionId = await seedBlogDefinition(jwt);

    const res = await app.inject({
      method: "GET",
      url: `/definitions/${definitionId}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = definitionResourceSchema.parse(res.json());
    expect(body).toMatchObject({
      id: definitionId,
      name: "Blog Post Pipeline",
      version: 1,
      templateKey: "blog-post-pipeline",
    });
    expect(body.graphSpec).toEqual(blogPostPipelineSpec);
  });

  it("serializes a legacy row without a spec as graphSpec/templateKey null", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const legacy = await repos.definitions.createDefinition({
      orgId,
      name: "Pre-spec definition",
      version: 1,
      parameters: {},
    });

    const res = await app.inject({
      method: "GET",
      url: `/definitions/${legacy.id}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = definitionResourceSchema.parse(res.json());
    expect(body.graphSpec).toBeNull();
    expect(body.templateKey).toBeNull();
  });

  it("404s unknown, cross-org, and non-uuid ids identically", async () => {
    const a = await signUpOwner(app);
    const b = await signUpOwner(app);
    const definitionId = await seedBlogDefinition(a.jwt);

    for (const url of [
      `/definitions/9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e`,
      `/definitions/${definitionId}`,
      `/definitions/not-a-uuid`,
    ]) {
      const res = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${b.jwt}` },
      });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(404);
      expect(res.json().error.code).toBe("not_found");
    }
  });

  it("401s an unauthenticated request", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/definitions/9e9e9e9e-9e9e-4e9e-8e9e-9e9e9e9e9e9e",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /definitions (Unit 32)", () => {
  it("saves v1, then v2 — and v1's row stays byte-identical (immutable versions)", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const v1 = await saveDefinition(jwt, drawnSpec("Research Digest"));
    expect(v1).toMatchObject({ name: "Research Digest", version: 1, templateKey: null });

    const v2 = await saveDefinition(jwt, drawnSpec("Research Digest", 2));
    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);

    const v1Row = await repos.definitions.findDefinitionById({ orgId, id: v1.id });
    expect(v1Row?.graphSpec).toEqual(drawnSpec("Research Digest"));
    expect(v1Row?.version).toBe(1);
  });

  it("400s a reserved template name and an invalid graph; 401s unauthenticated", async () => {
    const { jwt } = await signUpOwner(app);

    const reserved = await app.inject({
      method: "POST",
      url: "/definitions",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { graphSpec: drawnSpec("blog post pipeline") },
    });
    expect(reserved.statusCode, reserved.body).toBe(400);
    expect(reserved.json().error.message).toContain("built-in template name");

    const invalid = await app.inject({
      method: "POST",
      url: "/definitions",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { graphSpec: { ...drawnSpec("Loose Ends"), edges: [] } },
    });
    expect(invalid.statusCode).toBe(400);

    const unauthed = await app.inject({
      method: "POST",
      url: "/definitions",
      payload: { graphSpec: drawnSpec("No Auth") },
    });
    expect(unauthed.statusCode).toBe(401);
  });
});

describe("GET /definitions (Unit 32)", () => {
  it("lists the latest version per name with a name cursor; ?name= returns the history", async () => {
    const { jwt } = await signUpOwner(app);
    await saveDefinition(jwt, drawnSpec("Alpha Pipeline"));
    await saveDefinition(jwt, drawnSpec("Alpha Pipeline", 3));
    await saveDefinition(jwt, drawnSpec("Beta Pipeline"));

    const page1 = await app.inject({
      method: "GET",
      url: "/definitions?limit=1",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(page1.statusCode, page1.body).toBe(200);
    const first = definitionListResponseSchema.parse(page1.json());
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ name: "Alpha Pipeline", version: 2 });
    expect(first.nextCursor).toBe("Alpha Pipeline");

    const page2 = await app.inject({
      method: "GET",
      url: `/definitions?limit=10&cursor=${encodeURIComponent(first.nextCursor!)}`,
      headers: { authorization: `Bearer ${jwt}` },
    });
    const second = definitionListResponseSchema.parse(page2.json());
    expect(second.items.map((i) => i.name)).toContain("Beta Pipeline");
    expect(second.items.map((i) => i.name)).not.toContain("Alpha Pipeline");

    const history = await app.inject({
      method: "GET",
      url: "/definitions?name=Alpha%20Pipeline",
      headers: { authorization: `Bearer ${jwt}` },
    });
    const versions = definitionListResponseSchema.parse(history.json());
    expect(versions.items.map((i) => i.version)).toEqual([2, 1]);
    expect(versions.nextCursor).toBeNull();
  });

  it("is org-isolated — another org sees none of it", async () => {
    const a = await signUpOwner(app);
    const b = await signUpOwner(app);
    await saveDefinition(a.jwt, drawnSpec("Private Pipeline"));

    const res = await app.inject({
      method: "GET",
      url: "/definitions?name=Private%20Pipeline",
      headers: { authorization: `Bearer ${b.jwt}` },
    });
    expect(definitionListResponseSchema.parse(res.json()).items).toHaveLength(0);
  });
});

describe("POST /definitions/:id/runs (Unit 32)", () => {
  it("launches the interpreter with the PINNED spec — even an old version after v2 exists", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const v1 = await saveDefinition(jwt, drawnSpec("Versioned Pipeline"));
    await saveDefinition(jwt, drawnSpec("Versioned Pipeline", 2));

    const res = await app.inject({
      method: "POST",
      url: `/definitions/${v1.id}/runs`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { params: engineParams },
    });
    expect(res.statusCode, res.body).toBe(201);
    const run = runSchema.parse(res.json());
    expect(run).toMatchObject({
      status: "pending",
      workflowName: "Versioned Pipeline",
      definitionId: v1.id,
      temporalRunId: "tr-canvas-1",
    });

    // The gateway received v1's exact spec (no maximumAttempts override) —
    // a newer version cannot touch a run pinned to the old one.
    expect(starter.startInterpreter).toHaveBeenCalledTimes(1);
    const input = vi.mocked(starter.startInterpreter).mock.calls[0]![0]
      .input as InterpreterInput;
    expect(input.spec).toEqual(drawnSpec("Versioned Pipeline"));
    expect(input.templateKey).toBe("blog-post-pipeline");
    expect(input.orgId).toBe(orgId);
    expect(input.params).toEqual(engineParams);

    const row = await repos.runs.findRunById({ orgId, id: run.id });
    expect(row?.definitionId).toBe(v1.id);
  });

  it("400s bad params, 409s a spec-less definition, 404s unknown/cross-org ids", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const def = await saveDefinition(jwt, drawnSpec("Param Guard"));

    const bad = await app.inject({
      method: "POST",
      url: `/definitions/${def.id}/runs`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { params: { ...engineParams, wordCount: 9 } },
    });
    expect(bad.statusCode).toBe(400);
    expect(starter.startInterpreter).not.toHaveBeenCalled();

    const legacy = await repos.definitions.createDefinition({
      orgId,
      name: "Spec-less",
      version: 1,
      parameters: {},
    });
    const noSpec = await app.inject({
      method: "POST",
      url: `/definitions/${legacy.id}/runs`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { params: engineParams },
    });
    expect(noSpec.statusCode).toBe(409);
    expect(noSpec.json().error.code).toBe("definition_not_runnable");

    const other = await signUpOwner(app);
    const crossOrg = await app.inject({
      method: "POST",
      url: `/definitions/${def.id}/runs`,
      headers: { authorization: `Bearer ${other.jwt}` },
      payload: { params: engineParams },
    });
    expect(crossOrg.statusCode).toBe(404);
  });

  it("marks the pre-created row failed and 502s when the workflow start fails", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const def = await saveDefinition(jwt, drawnSpec("Start Failure"));
    vi.mocked(starter.startInterpreter).mockRejectedValueOnce(new Error("temporal down"));

    const res = await app.inject({
      method: "POST",
      url: `/definitions/${def.id}/runs`,
      headers: { authorization: `Bearer ${jwt}` },
      payload: { params: engineParams },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("run_start_failed");

    const page = await repos.runs.listRuns({ orgId, limit: 5 });
    const failed = page.items.find((r) => r.workflowName === "Start Failure");
    expect(failed?.status).toBe("failed");
  });
});
