import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { pool } from "./db";
import { env } from "./env";
import { logger } from "./logger";
import { closeRealtime } from "./realtime/publisher";

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
  try {
    const worker = await Worker.create({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
      taskQueue: env.TEMPORAL_TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL("./workflows/index.ts", import.meta.url)),
      activities,
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
    await connection.close();
    await closeRealtime();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "worker failed");
  process.exit(1);
});
