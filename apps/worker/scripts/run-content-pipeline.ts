import { Client, Connection } from "@temporalio/client";
import { TASK_QUEUE, blogPostPipelineInputSchema } from "@conductor/shared";
import { contentPipeline } from "../src/workflows";
import { env } from "../src/env";
import { logger } from "../src/logger";

/**
 * Starter script: kicks off a contentPipeline run with sample input and waits
 * for its terminal result. The run suspends at the approval gate — resume it
 * with: pnpm --filter @conductor/worker signal-approval <workflowId> approved
 *   pnpm --filter @conductor/worker run-pipeline "My topic"
 */
async function main(): Promise<void> {
  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
    const topic = process.argv[2] ?? "How durable workflows prevent lost AI runs";
    const input = blogPostPipelineInputSchema.parse({
      topic,
      keywords: ["durable execution", "temporal"],
      tone: "technical",
      wordCount: 1200,
      approverId: "user_demo",
    });
    const workflowId = `content-${topic.toLowerCase().replace(/\s+/g, "-").slice(0, 60)}`;

    const handle = await client.workflow.start(contentPipeline, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
    });
    logger.info(
      { workflowId, runId: handle.firstExecutionRunId },
      "started contentPipeline — suspends at the approval gate; signal it to resume",
    );

    const result = await handle.result();
    logger.info({ workflowId, result }, "contentPipeline finished");
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "run-content-pipeline failed");
  process.exit(1);
});
