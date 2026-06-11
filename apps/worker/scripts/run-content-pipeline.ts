import { Client, Connection } from "@temporalio/client";
import { TASK_QUEUE, interpreterInputSchema, templateCatalog } from "@conductor/shared";
import { interpreterWorkflow } from "../src/workflows";
import { env } from "../src/env";
import { logger } from "../src/logger";

/**
 * Starter script: kicks off a Blog Post Pipeline run (the interpreter walking
 * the catalog's blog spec — Unit 26 retired the hardcoded workflow) with
 * sample input and waits for its terminal result. The run suspends at the
 * approval gate — resume it with:
 * pnpm --filter @conductor/worker signal-approval <workflowId> approved
 *
 *   CONDUCTOR_ORG_ID=<orgId> pnpm --filter @conductor/worker run-pipeline "My topic"
 *
 * Since Unit 12, runs execute on the org's decrypted OpenRouter key, so the
 * org must exist and have a key configured (PUT /orgs/api-key on the server).
 */
async function main(): Promise<void> {
  const orgId = process.env.CONDUCTOR_ORG_ID;
  if (!orgId) {
    throw new Error(
      "CONDUCTOR_ORG_ID is required: runs are org-scoped and execute on the org's OpenRouter key (Unit 12).",
    );
  }

  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
    const topic = process.argv[2] ?? "How durable workflows prevent lost AI runs";
    const template = templateCatalog["blog-post-pipeline"];
    const input = interpreterInputSchema.parse({
      orgId,
      templateKey: template.key,
      spec: template.spec,
      params: {
        topic,
        keywords: ["durable execution", "temporal"],
        tone: "technical",
        wordCount: 1200,
        approverId: "user_demo",
      },
    });
    const workflowId = `content-${topic.toLowerCase().replace(/\s+/g, "-").slice(0, 60)}`;

    const handle = await client.workflow.start(interpreterWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [input],
    });
    logger.info(
      { workflowId, runId: handle.firstExecutionRunId },
      "started Blog Post Pipeline — suspends at the approval gate; signal it to resume",
    );

    const result = await handle.result();
    logger.info({ workflowId, result }, "Blog Post Pipeline finished");
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "run-content-pipeline failed");
  process.exit(1);
});
