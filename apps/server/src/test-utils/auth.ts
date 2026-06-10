import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * Test-only helpers for the real Better Auth flow (sign-up → org → set-active
 * → fresh JWT) used by route test suites. Requires local Postgres with all
 * migrations applied (mirrors auth.test.ts / api-keys.test.ts).
 */

export interface TestUser {
  sessionToken: string;
  jwt: string;
}

export interface TestOrgOwner extends TestUser {
  orgId: string;
}

export async function signUp(app: FastifyInstance): Promise<TestUser> {
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
  if (!sessionToken) throw new Error("sign-up returned no session token");
  return { sessionToken, jwt: await mintJwt(app, sessionToken) };
}

export async function mintJwt(
  app: FastifyInstance,
  sessionToken: string,
): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: "/api/auth/token",
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { token: string }).token;
}

/** Sign up, create an org, set it active, and return a JWT carrying it. */
export async function signUpOwner(app: FastifyInstance): Promise<TestOrgOwner> {
  const { sessionToken } = await signUp(app);
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
  return { sessionToken, orgId, jwt: await mintJwt(app, sessionToken) };
}
