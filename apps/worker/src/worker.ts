import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { pool } from "./db";
import { env } from "./env";
import { startHealthServer } from "./health";
import { logger } from "./logger";
import { closeRealtime } from "./realtime/publisher";
import { closeOrgModelsCache } from "./activities/org-models";

/**
 * Worker bootstrap. Connects to Temporal, bundles the deterministic workflows
 * (a sandbox violation in workflows/ surfaces here at bundle time), registers
 * the activities, and runs until SIGINT/SIGTERM — the SDK's default signal
 * handlers drain in-flight activities for graceful shutdown / the kill-restart
 * recovery demo.
 */
async function main(): Promise<void> {
  if (env.LLM_MODE === "mock") {
    logger.warn(
      "LLM_MODE=mock — agents return canned model output (E2E/dev only; never production)",
    );
  }
  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });
  let health: ReturnType<typeof startHealthServer> | undefined;
  try {
    const worker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL("./workflows/index.ts", import.meta.url)),
      activities,
    });

    // Platform health surface (Unit 28a): readiness = worker RUNNING + PG
    // answering. Started only once the worker exists, so /ready can never
    // report ready before the bundle compiled and Temporal accepted us.
    health = startHealthServer({
      port: env.WORKER_HEALTH_PORT,
      checks: {
        temporal: () => worker.getState() === "RUNNING",
        postgres: async () => {
          const probe = await Promise.race([
            pool.query("select 1").then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
          ]);
          return probe;
        },
      },
    });

    logger.info(
      {
        taskQueue: env.TEMPORAL_TASK_QUEUE,
        address: env.TEMPORAL_ADDRESS,
        namespace: env.TEMPORAL_NAMESPACE,
      },
      "worker ready",
    );

    await worker.run();
    logger.info("worker shut down cleanly");
  } finally {
    health?.close();
    await connection.close();
    await closeRealtime();
    await closeOrgModelsCache();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "worker failed");
  process.exit(1);
});
