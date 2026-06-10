import { buildApp } from "./app";
import { createDeps } from "./deps";
import { createRunGateway } from "./temporal";
import { auth } from "./auth/auth";
import { env } from "./env";
import { logger } from "./logger";

/**
 * Server bootstrap: build dependency clients, build the app over their readiness
 * checks, listen, and shut down gracefully — stop accepting connections, close
 * the app, then drain the dependency clients (architecture Scalability & Operations).
 */
async function main(): Promise<void> {
  const deps = createDeps(env);
  const temporal = createRunGateway(deps.temporalConnection, env.TEMPORAL_NAMESPACE);
  const app = await buildApp({ checks: deps.checks, auth, temporal, realtime: true });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "server shutting down");
    try {
      await app.close();
      await deps.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.SERVER_PORT, host: env.HOST });
}

main().catch((err: unknown) => {
  logger.error({ err }, "server failed to start");
  process.exit(1);
});
