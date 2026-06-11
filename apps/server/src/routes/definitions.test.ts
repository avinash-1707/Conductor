import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  blogPostPipelineSpec,
  definitionResourceSchema,
  templateListResponseSchema,
} from "@conductor/shared";
import { buildApp } from "../app";
import { auth } from "../auth/auth";
import { repos } from "../repos/index";
import { signUpOwner } from "../test-utils/auth";

/**
 * Definition route tests (Unit 30) — real Better Auth + Postgres. The route is
 * the canvas viewer's path to a run's pinned spec; tenancy semantics mirror
 * every other org-scoped resource (unknown / cross-org / non-uuid = same 404).
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
