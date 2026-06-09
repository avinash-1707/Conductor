import { Client, Connection } from "@temporalio/client";
import { TASK_QUEUE } from "@conductor/shared";
import { helloWorkflow } from "../src/workflows";
import { env } from "../src/env";
import { logger } from "../src/logger";

/**
 * Starter script: kicks off helloWorkflow via the Temporal Client and prints
 * the result. A deterministic workflowId keeps reruns observable in the UI.
 *   pnpm --filter @conductor/worker run-hello "Ada"
 */
async function main(): Promise<void> {
  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
    const name = process.argv[2] ?? "Conductor";
    const workflowId = `hello-${name.toLowerCase().replace(/\s+/g, "-")}`;

    const handle = await client.workflow.start(helloWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [{ name }],
    });
    logger.info({ workflowId, runId: handle.firstExecutionRunId }, "started helloWorkflow");

    const result = await handle.result();
    logger.info({ workflowId, result }, "helloWorkflow completed");
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "run-hello failed");
  process.exit(1);
});
