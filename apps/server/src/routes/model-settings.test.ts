import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import Redis from "ioredis";
import { redisKeys, type ModelOption } from "@conductor/shared";
import { buildApp } from "../app";
import { auth } from "../auth/auth";

/**
 * Org model selection routes (Unit 33). Real Better Auth + Postgres + Redis
 * (like the api-keys suite); the OpenRouter catalog is an injected stub.
 */
const checks = {
  postgres: async () => true,
  redis: async () => true,
  temporal: async () => true,
};

const CATALOG: ModelOption[] = [
  { id: "anthropic/claude-fable-5", name: "Claude Fable 5", provider: "anthropic", free: false },
  { id: "openai/gpt-5.5", name: "GPT-5.5", provider: "openai", free: false },
  { id: "qwen/qwen-4:free", name: "Qwen 4 (free)", provider: "qwen", free: true },
];

let app: FastifyInstance;
let catalogFails = false;
const redis = new Redis("redis://localhost:6379");

beforeAll(async () => {
  app = await buildApp({
    checks,
    auth,
    modelCatalog: async () => {
      if (catalogFails) throw new Error("upstream down");
      return CATALOG;
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  redis.disconnect();
});

async function signUp(): Promise<string> {
  const email = `u_${randomUUID()}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: "Sup3r-secret-pw", name: "Test User" },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (
    (res.headers["set-auth-token"] as string | undefined) ??
    (res.json() as { token: string }).token
  );
}

async function mintJwt(sessionToken: string): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: "/api/auth/token",
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { token: string }).token;
}

/** Sign up, create an org, set it active; returns the org-carrying JWT + orgId. */
async function signUpOwner(): Promise<{ jwt: string; orgId: string }> {
  const sessionToken = await signUp();
  const created = await app.inject({
    method: "POST",
    url: "/api/auth/organization/create",
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: { name: "Acme", slug: `acme-${randomUUID().slice(0, 8)}` },
  });
  expect(created.statusCode, created.body).toBe(200);
  const orgId = (created.json() as { id: string }).id;
  const setActive = await app.inject({
    method: "POST",
    url: "/api/auth/organization/set-active",
    headers: { authorization: `Bearer ${sessionToken}` },
    payload: { organizationId: orgId },
  });
  expect(setActive.statusCode, setActive.body).toBe(200);
  return { jwt: await mintJwt(sessionToken), orgId };
}

describe("GET /orgs/models", () => {
  it("returns the curated catalog to a member", async () => {
    const { jwt } = await signUpOwner();
    const res = await app.inject({
      method: "GET",
      url: "/orgs/models",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ models: CATALOG });
  });

  it("502s with a typed code when the catalog is unavailable", async () => {
    const { jwt } = await signUpOwner();
    catalogFails = true;
    try {
      const res = await app.inject({
        method: "GET",
        url: "/orgs/models",
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(502);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        "model_catalog_unavailable",
      );
    } finally {
      catalogFails = false;
    }
  });

  it("401s an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/orgs/models" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET/PUT /orgs/model-settings", () => {
  it("returns nulls plus the platform defaults before any choice is made", async () => {
    const { jwt } = await signUpOwner();
    const res = await app.inject({
      method: "GET",
      url: "/orgs/model-settings",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      settings: { researchModel: null, writingModel: null },
      defaults: {
        research: "anthropic/claude-sonnet-4.5",
        writing: "anthropic/claude-opus-4.8",
      },
    });
  });

  it("lets an owner replace the choice and invalidates the worker cache", async () => {
    const { jwt, orgId } = await signUpOwner();
    // Pre-seed a stale cache entry — the PUT must delete it.
    const cacheKey = redisKeys.orgModelSettings(orgId);
    await redis.set(cacheKey, JSON.stringify({ researchModel: null, writingModel: null }));

    const res = await app.inject({
      method: "PUT",
      url: "/orgs/model-settings",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { researchModel: "openai/gpt-5.5", writingModel: null },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { settings: unknown }).settings).toEqual({
      researchModel: "openai/gpt-5.5",
      writingModel: null,
    });
    expect(await redis.get(cacheKey)).toBeNull();

    const after = await app.inject({
      method: "GET",
      url: "/orgs/model-settings",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect((after.json() as { settings: { researchModel: string } }).settings.researchModel).toBe(
      "openai/gpt-5.5",
    );

    // Upsert, not insert-only: a second PUT replaces.
    const back = await app.inject({
      method: "PUT",
      url: "/orgs/model-settings",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { researchModel: null, writingModel: "anthropic/claude-fable-5" },
    });
    expect((back.json() as { settings: unknown }).settings).toEqual({
      researchModel: null,
      writingModel: "anthropic/claude-fable-5",
    });
  });

  it("400s a malformed model id and a partial body", async () => {
    const { jwt } = await signUpOwner();
    const bad = await app.inject({
      method: "PUT",
      url: "/orgs/model-settings",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { researchModel: "not a slug", writingModel: null },
    });
    expect(bad.statusCode).toBe(400);

    const partial = await app.inject({
      method: "PUT",
      url: "/orgs/model-settings",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { researchModel: null },
    });
    expect(partial.statusCode).toBe(400);
  });

  it("403s a PUT from a user with no active organization", async () => {
    const sessionToken = await signUp();
    const jwt = await mintJwt(sessionToken);
    const res = await app.inject({
      method: "PUT",
      url: "/orgs/model-settings",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { researchModel: null, writingModel: null },
    });
    expect(res.statusCode).toBe(403);
  });

  it("401s unauthenticated requests on both verbs", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/orgs/model-settings" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/orgs/model-settings",
          payload: { researchModel: null, writingModel: null },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("keeps settings org-scoped: another org never sees them (tenancy)", async () => {
    const a = await signUpOwner();
    const b = await signUpOwner();

    await app.inject({
      method: "PUT",
      url: "/orgs/model-settings",
      headers: { authorization: `Bearer ${a.jwt}` },
      payload: { researchModel: "openai/gpt-5.5", writingModel: "openai/gpt-5.5" },
    });

    const other = await app.inject({
      method: "GET",
      url: "/orgs/model-settings",
      headers: { authorization: `Bearer ${b.jwt}` },
    });
    expect((other.json() as { settings: unknown }).settings).toEqual({
      researchModel: null,
      writingModel: null,
    });
  });
});
