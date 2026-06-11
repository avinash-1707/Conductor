import { Client, Connection } from "@temporalio/client";
import { approvalSignalPayloadSchema, approvalDecisionSchema } from "@conductor/shared";
import { interpreterApprovalSignal } from "../src/workflows";
import { env } from "../src/env";
import { logger } from "../src/logger";

/**
 * Sends the approvalDecision signal to a suspended run —
 * the manual stand-in for the Phase 2 approve/reject API route.
 *   pnpm --filter @conductor/worker signal-approval <workflowId> approved|rejected
 */
async function main(): Promise<void> {
  const workflowId = process.argv[2];
  if (!workflowId) {
    throw new Error("Usage: signal-approval <workflowId> [approved|rejected]");
  }
  const decision = approvalDecisionSchema.parse(process.argv[3] ?? "approved");
  const payload = approvalSignalPayloadSchema.parse({
    decision,
    reviewerId: "user_demo",
    decidedAt: new Date().toISOString(),
  });

  const connection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
  try {
    const client = new Client({ connection, namespace: env.TEMPORAL_NAMESPACE });
    await client.workflow.getHandle(workflowId).signal(interpreterApprovalSignal, payload);
    logger.info({ workflowId, decision }, "approvalDecision signal sent");
  } finally {
    await connection.close();
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "signal-approval failed");
  process.exit(1);
});
