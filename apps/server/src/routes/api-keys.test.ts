import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { auth } from "../auth/auth";
import { decryptApiKey, encryptApiKey } from "../secrets";

/**
 * Integration tests for org API-key management (Unit 11). Exercises the real
 * Better Auth flow (sign-up → org → set-active → fresh JWT) and asserts the
 * plaintext key never appears in any response or log line (invariant 12).
 * Requires local Postgres with migration #2 applied.
 */
const checks = {
  postgres: async () => true,
  redis: async () => true,
  temporal: async () => true,
};

let app: FastifyInstance;
const logs: string[] = [];

beforeAll(async () => {
  app = await buildApp({
    checks,
    auth,
    logStream: { write: (msg: string) => logs.push(msg) },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

interface Creds {
  sessionToken: string;
  jwt: string;
}

async function signUp(): Promise<Creds> {
  const email = `u_${randomUUID()}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { email, password: "Sup3r-secret-pw", name: "Test User" },
  });
  expect(res.statusCode, res.body).toBe(200);
  const sessionToken =
    (res.headers["set-auth-token"] as string | undefined) ??
    (res.json() as { token?: string }).token;
  return { sessionToken: sessionToken!, jwt: await mintJwt(sessionToken!) };
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

/** Sign up, create an org, set it active, and return a JWT carrying it. */
async function signUpOwner(): Promise<string> {
  const { sessionToken } = await signUp();
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
  return mintJwt(sessionToken);
}

describe("PUT /orgs/api-key", () => {
  it("lets an owner set a key and never returns the plaintext", async () => {
    const jwt = await signUpOwner();
    const apiKey = `sk-or-v1-${randomUUID().replace(/-/g, "")}`;
    const res = await app.inject({
      method: "PUT",
      url: "/orgs/api-key",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { apiKey },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true, last4: apiKey.slice(-4) });
    expect(res.body).not.toContain(apiKey);
  });

  it("never writes the plaintext key to the logs", async () => {
    const jwt = await signUpOwner();
    const apiKey = `sk-or-v1-${randomUUID().replace(/-/g, "")}`;
    logs.length = 0;
    await app.inject({
      method: "PUT",
      url: "/orgs/api-key",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { apiKey },
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(logs.join("")).not.toContain(apiKey);
  });

  it("403s a user with no active organization", async () => {
    const { jwt } = await signUp();
    const res = await app.inject({
      method: "PUT",
      url: "/orgs/api-key",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { apiKey: `sk-or-v1-${randomUUID().replace(/-/g, "")}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("401s an unauthenticated request", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/orgs/api-key",
      payload: { apiKey: `sk-or-v1-${randomUUID().replace(/-/g, "")}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s an invalid body", async () => {
    const jwt = await signUpOwner();
    const res = await app.inject({
      method: "PUT",
      url: "/orgs/api-key",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { apiKey: "short" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /orgs/api-key", () => {
  it("reports configured status and last4 without the key", async () => {
    const jwt = await signUpOwner();

    const before = await app.inject({
      method: "GET",
      url: "/orgs/api-key",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(before.json()).toEqual({ configured: false, last4: null });

    const apiKey = `sk-or-v1-${randomUUID().replace(/-/g, "")}`;
    await app.inject({
      method: "PUT",
      url: "/orgs/api-key",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { apiKey },
    });

    const after = await app.inject({
      method: "GET",
      url: "/orgs/api-key",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(after.json()).toEqual({ configured: true, last4: apiKey.slice(-4) });
    expect(after.body).not.toContain(apiKey);
  });

  it("401s an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/orgs/api-key" });
    expect(res.statusCode).toBe(401);
  });
});

describe("secrets round-trip", () => {
  it("decrypts what it encrypts", () => {
    const key = `sk-or-v1-${randomUUID()}`;
    const token = encryptApiKey(key);
    expect(token).not.toContain(key);
    expect(decryptApiKey(token)).toBe(key);
  });
});
