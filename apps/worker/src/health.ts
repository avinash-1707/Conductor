import { createServer, type Server } from "node:http";
import { logger } from "./logger";

/**
 * Liveness/readiness surface for platform health checks (Unit 28a) — the
 * worker's only HTTP. `GET /health` answers 200 while the process lives;
 * `GET /ready` mirrors the server's shape (per-check booleans, 200/503).
 * Redis is deliberately NOT a readiness check: realtime publishes are
 * best-effort by design (Unit 17) — a worker without Redis still executes
 * runs correctly, and readiness must not flap on a non-essential dependency.
 */
export interface WorkerReadinessChecks {
  /** True when the Temporal worker's state is RUNNING. */
  temporal(): boolean;
  /** True when Postgres answers a probe query (timeout-bounded). */
  postgres(): Promise<boolean>;
}

export function startHealthServer(opts: {
  port: number;
  checks: WorkerReadinessChecks;
}): Server {
  const server = createServer((req, res) => {
    const respond = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method !== "GET") return respond(405, { error: "method_not_allowed" });
    if (req.url === "/health") return respond(200, { status: "ok" });
    if (req.url === "/ready") {
      const temporal = opts.checks.temporal();
      void opts.checks
        .postgres()
        .catch(() => false)
        .then((postgres) => {
          const ready = temporal && postgres;
          respond(ready ? 200 : 503, {
            status: ready ? "ready" : "not_ready",
            checks: { temporal, postgres },
          });
        });
      return;
    }
    return respond(404, { error: "not_found" });
  });

  // Explicit IPv4 bind, matching the server's HOST default — a bare
  // listen(port) binds `::`, which some container network stacks
  // (Docker Desktop host networking) don't forward.
  server.listen(opts.port, "0.0.0.0", () => {
    logger.info({ port: opts.port }, "worker health server listening");
  });
  return server;
}
