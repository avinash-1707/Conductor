import { and, eq } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { db } from "../db/client";
import { member } from "@conductor/db";
import { ForbiddenError, UnauthorizedError } from "../errors";
import type { Auth } from "./auth";
import { createSessionVerifier, type SessionClaims } from "./verify";

declare module "fastify" {
  interface FastifyRequest {
    auth?: SessionClaims;
  }
  interface FastifyInstance {
    requireSession: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireOwner: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Registers Better Auth on the app: mounts `/api/auth/*` to the auth handler and
 * decorates `requireSession` / `requireOwner` preHandlers. Operates on the passed
 * app instance directly (no sub-encapsulation) so the decorators are visible to
 * routes registered anywhere on it.
 */
export async function registerAuth(
  app: FastifyInstance,
  opts: { auth: Auth },
): Promise<void> {
  const { auth } = opts;
  const verify = createSessionVerifier(auth);

  // Mount the Better Auth request handler (web Request/Response bridge).
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: async (request, reply) => {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);
      const init: RequestInit = { method: request.method, headers };
      if (request.body !== undefined && request.body !== null) {
        init.body =
          typeof request.body === "string"
            ? request.body
            : JSON.stringify(request.body);
      }
      const response = await auth.handler(new Request(url.toString(), init));

      reply.status(response.status);
      const setCookies = response.headers.getSetCookie?.() ?? [];
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== "set-cookie") reply.header(key, value);
      });
      if (setCookies.length > 0) reply.header("set-cookie", setCookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });

  app.decorate("requireSession", async (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing bearer token");
    }
    req.auth = await verify(header.slice("Bearer ".length));
  });

  app.decorate("requireOwner", async (req: FastifyRequest, reply: FastifyReply) => {
    await app.requireSession(req, reply);
    const claims = req.auth;
    if (!claims?.activeOrganizationId) {
      throw new ForbiddenError("No active organization");
    }
    const rows = await db
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.userId, claims.userId),
          eq(member.organizationId, claims.activeOrganizationId),
        ),
      )
      .limit(1);
    if (rows[0]?.role !== "owner") {
      throw new ForbiddenError("Owner role required");
    }
  });
}
