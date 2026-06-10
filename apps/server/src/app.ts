import { randomUUID } from "node:crypto";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { env } from "./env";
import { AppError } from "./errors";
import { healthRoutes } from "./routes/health";
import { registerAuth } from "./auth/plugin";
import type { Auth } from "./auth/auth";
import type { ReadinessChecks } from "./deps";

/**
 * Builds the Fastify app (no `listen` — usable directly by `fastify.inject`
 * tests). When `auth` is provided, Better Auth is mounted at `/api/auth/*` and
 * `requireSession`/`requireOwner` are decorated. Health-only tests omit it (no
 * DB needed). Per-domain route plugins and the WebSocket relay layer on later.
 */
export async function buildApp(opts: {
  checks: ReadinessChecks;
  auth?: Auth;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL, base: { app: "server" } },
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "requestId",
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
    },
  });

  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });

  // One central handler — handlers throw typed errors, never hand-roll responses.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: { code: err.code, message: err.message },
      });
    }
    // Fastify schema validation failures.
    if (err.validation) {
      return reply.code(400).send({
        error: { code: "validation_error", message: err.message },
      });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, "unhandled error");
      return reply.code(500).send({
        error: { code: "internal", message: "Internal Server Error" },
      });
    }
    return reply.code(status).send({ error: { code: "error", message: err.message } });
  });

  app.setNotFoundHandler((req, reply) => {
    return reply.code(404).send({
      error: {
        code: "not_found",
        message: `Route ${req.method} ${req.url} not found`,
      },
    });
  });

  await app.register(healthRoutes, { checks: opts.checks });

  if (opts.auth) {
    await registerAuth(app, { auth: opts.auth });
  }

  return app;
}
