import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  GRAPH_SPEC_VERSION,
  blogPostPipelineSpec,
  graphSpecSchema,
  templateListResponseSchema,
} from "@conductor/shared";
import { buildApp } from "../app";
import { auth } from "../auth/auth";
import { repos } from "../repos/index";
import { signUpOwner } from "../test-utils/auth";

/**
 * Workflow Library route tests (Unit 26) — real Better Auth + Postgres.
 * `GET /templates` is the seeding trigger: it materializes the org's pinned
 * `workflow_definitions` rows from the shared catalog, idempotently, and rolls
 * a NEW version when the catalog evolved — never editing the pinned row.
 */
const checks = {
  postgres: async () => true,
  redis: async () => true,
  temporal: async () => true,
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ checks, auth });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

async function listTemplates(jwt: string) {
  const res = await app.inject({
    method: "GET",
    url: "/templates",
    headers: { authorization: `Bearer ${jwt}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  return templateListResponseSchema.parse(res.json());
}

describe("GET /templates", () => {
  it("seeds the org's definition row from the catalog and lists it", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    const body = await listTemplates(jwt);

    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      key: "blog-post-pipeline",
      name: "Blog Post Pipeline",
      version: 1,
    });

    const stored = await repos.definitions.findDefinitionById({
      orgId,
      id: body.items[0]!.definitionId,
    });
    expect(stored?.graphSpec).toEqual(blogPostPipelineSpec);
    expect(stored?.parameters).toEqual({ templateKey: "blog-post-pipeline" });
  });

  it("is idempotent — a second list returns the same pinned row", async () => {
    const { jwt } = await signUpOwner(app);
    const first = await listTemplates(jwt);
    const second = await listTemplates(jwt);
    expect(second.items[0]?.definitionId).toBe(first.items[0]?.definitionId);
    expect(second.items[0]?.version).toBe(1);
  });

  it("rolls a NEW version when the catalog evolved, leaving the old row pinned", async () => {
    const { jwt, orgId } = await signUpOwner(app);
    // Simulate an older deploy's seeding: same template name, a spec that
    // deep-differs from today's catalog (tightened research retries).
    const oldSpec = graphSpecSchema.parse({
      specVersion: GRAPH_SPEC_VERSION,
      name: "Blog Post Pipeline",
      nodes: blogPostPipelineSpec.nodes.map((n) =>
        n.type === "research" ? { ...n, config: { maximumAttempts: 2 } } : n,
      ),
      edges: blogPostPipelineSpec.edges,
    });
    const v1 = await repos.definitions.createDefinitionVersion({
      orgId,
      name: "Blog Post Pipeline",
      graphSpec: oldSpec,
      parameters: { templateKey: "blog-post-pipeline" },
    });
    expect(v1.version).toBe(1);

    const body = await listTemplates(jwt);
    expect(body.items[0]?.version).toBe(2);
    expect(body.items[0]?.definitionId).not.toBe(v1.id);

    // The superseded version row is untouched — runs pinned to it stay exact.
    const v1Again = await repos.definitions.findDefinitionById({ orgId, id: v1.id });
    expect(v1Again?.graphSpec).toEqual(oldSpec);
    expect(v1Again?.version).toBe(1);
  });

  it("seeds per org — two orgs get distinct definition rows", async () => {
    const a = await signUpOwner(app);
    const b = await signUpOwner(app);
    const listA = await listTemplates(a.jwt);
    const listB = await listTemplates(b.jwt);
    expect(listA.items[0]?.definitionId).not.toBe(listB.items[0]?.definitionId);

    // Org A's row is invisible to org B (tenancy 404 semantics at the repo).
    const crossOrg = await repos.definitions.findDefinitionById({
      orgId: b.orgId,
      id: listA.items[0]!.definitionId,
    });
    expect(crossOrg).toBeUndefined();
  });

  it("401s an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/templates" });
    expect(res.statusCode).toBe(401);
  });
});
