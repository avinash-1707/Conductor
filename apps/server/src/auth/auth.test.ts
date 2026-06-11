import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import { auth, createAuth } from "./auth";
import type { AuthEmail, EmailSender } from "./email";

/**
 * Integration tests against the local Postgres (migration #1 applied). Exercise
 * the real Better Auth flow: sign-up → JWT → bearer-protected route, plus the
 * org-owner gate. Each test uses a unique email so reruns don't collide.
 */
const checks = {
  postgres: async () => true,
  redis: async () => true,
  temporal: async () => true,
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ checks, auth });
  // Protected probes (registered on the root app so the decorators are visible).
  app.get("/__me", { preHandler: (req, reply) => app.requireSession(req, reply) }, async (req) => ({
    userId: req.auth?.userId,
    activeOrganizationId: req.auth?.activeOrganizationId ?? null,
  }));
  app.get(
    "/__owner",
    { preHandler: (req, reply) => app.requireOwner(req, reply) },
    async () => ({ ok: true }),
  );
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

interface Creds {
  email: string;
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
  expect(sessionToken, "session token from sign-up").toBeTruthy();
  const jwt = await mintJwt(sessionToken!);
  return { email, sessionToken: sessionToken!, jwt };
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

describe("auth endpoints", () => {
  it("GET /api/auth/ok responds 200", async () => {
    const res = await app.inject({ method: "GET", url: "/api/auth/ok" });
    expect(res.statusCode).toBe(200);
  });

  it("signs up and issues a verifiable JWT", async () => {
    const { jwt } = await signUp();
    expect(jwt.split(".")).toHaveLength(3);
  });
});

describe("requireSession", () => {
  it("rejects a missing bearer token with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/__me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: "unauthorized", message: "Missing bearer token" },
    });
  });

  it("rejects a malformed token with 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__me",
      headers: { authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a valid JWT and resolves the user", async () => {
    const { jwt } = await signUp();
    const res = await app.inject({
      method: "GET",
      url: "/__me",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { userId?: string }).userId).toBeTruthy();
  });
});

describe("requireOwner", () => {
  it("allows the org creator (owner) and 403s a user with no active org", async () => {
    const nonOwner = await signUp();
    const denied = await app.inject({
      method: "GET",
      url: "/__owner",
      headers: { authorization: `Bearer ${nonOwner.jwt}` },
    });
    expect(denied.statusCode).toBe(403);

    // Owner path: create an org, set it active, mint a fresh JWT carrying it.
    const owner = await signUp();
    const created = await app.inject({
      method: "POST",
      url: "/api/auth/organization/create",
      headers: { authorization: `Bearer ${owner.sessionToken}` },
      payload: { name: "Acme", slug: `acme-${randomUUID().slice(0, 8)}` },
    });
    expect(created.statusCode, created.body).toBe(200);
    const orgId = (created.json() as { id: string }).id;

    const setActive = await app.inject({
      method: "POST",
      url: "/api/auth/organization/set-active",
      headers: { authorization: `Bearer ${owner.sessionToken}` },
      payload: { organizationId: orgId },
    });
    expect(setActive.statusCode, setActive.body).toBe(200);

    const ownerJwt = await mintJwt(owner.sessionToken);
    const allowed = await app.inject({
      method: "GET",
      url: "/__owner",
      headers: { authorization: `Bearer ${ownerJwt}` },
    });
    expect(allowed.statusCode, allowed.body).toBe(200);
  });
});

describe("invitation email (Unit 27)", () => {
  it("delivers the accept link through the injected EmailSender", async () => {
    const sent: AuthEmail[] = [];
    const capturing: EmailSender = {
      async send(email) {
        sent.push(email);
      },
    };
    const inviteApp = await buildApp({ checks, auth: createAuth(capturing) });
    await inviteApp.ready();
    try {
      // Owner with an active org (same flow as the requireOwner test).
      const email = `u_${randomUUID()}@example.com`;
      const signUpRes = await inviteApp.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        payload: { email, password: "Sup3r-secret-pw", name: "Owner" },
      });
      expect(signUpRes.statusCode, signUpRes.body).toBe(200);
      const sessionToken = signUpRes.headers["set-auth-token"] as string;
      const created = await inviteApp.inject({
        method: "POST",
        url: "/api/auth/organization/create",
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { name: "Invite Co", slug: `invite-${randomUUID().slice(0, 8)}` },
      });
      expect(created.statusCode, created.body).toBe(200);
      const orgId = (created.json() as { id: string }).id;
      await inviteApp.inject({
        method: "POST",
        url: "/api/auth/organization/set-active",
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { organizationId: orgId },
      });

      const invited = await inviteApp.inject({
        method: "POST",
        url: "/api/auth/organization/invite-member",
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { email: `reviewer_${randomUUID()}@example.com`, role: "member" },
      });
      expect(invited.statusCode, invited.body).toBe(200);
      const invitationId = (invited.json() as { id: string }).id;

      // The email carries the canonical accept link for exactly this invitation.
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toContain(`/accept-invitation/${invitationId}`);
      expect(sent[0]?.subject).toContain("Invite Co");
    } finally {
      await inviteApp.close();
    }
  });
});
