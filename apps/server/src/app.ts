import { randomUUID } from "node:crypto";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { DestinationStream } from "pino";
import { env } from "./env";
import { AppError } from "./errors";
import { healthRoutes } from "./routes/health";
import { apiKeyRoutes } from "./routes/api-keys";
import { modelSettingsRoutes } from "./routes/model-settings";
import type { KeyVerification } from "./lib/openrouter";
import type { ModelOption } from "@conductor/shared";
import { closeCache } from "./cache";
import { runRoutes } from "./routes/runs";
import { approvalRoutes } from "./routes/approvals";
import { templateRoutes } from "./routes/templates";
import { definitionRoutes } from "./routes/definitions";
import { registerAuth } from "./auth/plugin";
import { createSessionVerifier } from "./auth/verify";
import { createRealtime } from "./realtime/io";
import type { Auth } from "./auth/auth";
import type { ReadinessChecks } from "./deps";
import type { RunGateway } from "./temporal";

/**
 * Builds the Fastify app (no `listen` — usable directly by `fastify.inject`
 * tests). When `auth` is provided, Better Auth is mounted at `/api/auth/*` and
 * `requireSession`/`requireOwner` are decorated. Health-only tests omit it (no
 * DB needed). Per-domain route plugins and the WebSocket relay layer on later.
 */
export async function buildApp(opts: {
  checks: ReadinessChecks;
  auth?: Auth;
  /** Temporal client seam — run/approval routes register when auth + temporal are present. */
  temporal?: RunGateway;
  /** When true (and auth is present), attach the Socket.IO realtime relay. Off
   *  by default so inject-only tests need no Redis; server.ts and the ws test set it. */
  realtime?: boolean;
  /** Optional pino destination — tests pass a capturing stream to assert logs. */
  logStream?: DestinationStream;
  /** Test seam — BYOK verification stub (Unit 33); defaults to the live OpenRouter check. */
  verifyKey?: (apiKey: string) => Promise<KeyVerification>;
  /** Test seam — model catalog stub (Unit 33); defaults to the cached OpenRouter fetcher. */
  modelCatalog?: () => Promise<ModelOption[]>;
}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      base: { app: "server" },
      ...(opts.logStream ? { stream: opts.logStream } : {}),
    },
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "requestId",
    genReqId: (req) => {
      const header = req.headers["x-request-id"];
      return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
    },
  });

  await app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true,
    // @fastify/cors defaults to GET,HEAD,POST — without PUT here the browser
    // preflight rejects the key-management PUT (found by the Unit 23 E2E).
    methods: ["GET", "HEAD", "POST", "PUT"],
    // The browser auth client reads the session token / JWT from these headers
    // cross-origin (bearer flow); they must be exposed to client JS.
    exposedHeaders: ["set-auth-token", "set-auth-jwt"],
  });

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
    await app.register(apiKeyRoutes({ verifyKey: opts.verifyKey }));
    await app.register(
      modelSettingsRoutes(opts.modelCatalog ? { catalog: opts.modelCatalog } : undefined),
    );
    await app.register(templateRoutes());
    await app.register(definitionRoutes(opts.temporal));
    if (opts.temporal) {
      await app.register(runRoutes(opts.temporal));
      await app.register(approvalRoutes(opts.temporal));
    }
    if (opts.realtime) {
      // Attach Socket.IO to Fastify's underlying HTTP server. The verifier
      // reuses the JWKS-backed token verification used by REST.
      const realtime = createRealtime({
        httpServer: app.server,
        verify: createSessionVerifier(opts.auth),
        redisUrl: env.REDIS_URL,
        corsOrigin: env.WEB_ORIGIN,
      });
      app.addHook("onClose", () => realtime.close());
    }
  }

  app.addHook("onClose", () => closeCache());

  return app;
}
