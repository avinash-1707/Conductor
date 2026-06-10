import type { FastifyPluginAsync } from "fastify";
import type { ReadinessChecks } from "../deps";

/**
 * Liveness + readiness. `/health` answers as long as the process is up;
 * `/ready` reflects Postgres/Redis/Temporal connectivity (architecture
 * Scalability & Operations) — 503 when any dependency is down so a load
 * balancer can route around a degraded instance.
 */
export const healthRoutes: FastifyPluginAsync<{ checks: ReadinessChecks }> = async (
  app,
  opts,
) => {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/ready", async (_req, reply) => {
    const [postgres, redis, temporal] = await Promise.all([
      opts.checks.postgres(),
      opts.checks.redis(),
      opts.checks.temporal(),
    ]);
    const checks = { postgres, redis, temporal };
    const ready = postgres && redis && temporal;
    return reply
      .code(ready ? 200 : 503)
      .send({ status: ready ? "ready" : "not_ready", checks });
  });
};
