import { z } from "zod";
import { ApplicationFailure } from "@temporalio/activity";
import { approvalContextSchema } from "@conductor/shared";
import { repos } from "../db";
import { logger } from "../logger";
import { publishRunEvent } from "../realtime/publisher";
import { workflowExecutionContext } from "./activity-context";

/**
 * Creates the approval gate record (Unit 14, replacing the Unit 04 stub).
 * A short record-write only — the human wait stays in the workflow as a
 * signal + condition() (architecture invariant 3). Idempotent: the approval
 * is keyed by the run (unique `run_id`), and a retry after a reviewer already
 * decided returns the existing row untouched. Also flips the run projection
 * to `suspended` — the dashboard badge the reviewer reacts to.
 */
export const createApprovalRequestInputSchema = z.object({
  orgId: z.string().min(1),
  approverId: z.string().min(1),
  context: approvalContextSchema,
});
export type CreateApprovalRequestInput = z.infer<
  typeof createApprovalRequestInputSchema
>;

export const createApprovalRequestOutputSchema = z.object({
  approvalId: z.uuid(),
});
export type CreateApprovalRequestOutput = z.infer<
  typeof createApprovalRequestOutputSchema
>;

export async function createApprovalRequest(
  input: CreateApprovalRequestInput,
): Promise<CreateApprovalRequestOutput> {
  const parsed = createApprovalRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      `Invalid createApprovalRequest input: ${parsed.error.message}`,
      "InvalidActivityInput",
    );
  }
  const { orgId, approverId, context } = parsed.data;
  const { workflowId: temporalWorkflowId } = workflowExecutionContext();

  const run = await repos.runs.findRunByTemporalId({ orgId, temporalWorkflowId });
  if (!run) {
    // recordRunStarted precedes the gate; a missing row is transient.
    throw new Error(
      `workflow_runs projection row missing for workflow ${temporalWorkflowId}`,
    );
  }

  const approval = await repos.approvals.upsertApprovalForRun({
    orgId,
    runId: run.id,
    context,
  });
  await repos.runs.markRunStatus({ orgId, temporalWorkflowId, status: "suspended" });

  const at = new Date().toISOString();
  await publishRunEvent({ type: "run.status", runId: run.id, status: "suspended", at });
  await publishRunEvent({
    type: "approval.requested",
    runId: run.id,
    approvalId: approval.id,
    orgId,
    at,
  });

  logger.info(
    {
      activity: "createApprovalRequest",
      orgId,
      runId: run.id,
      approvalId: approval.id,
      approverId,
    },
    "approval requested — run suspended at the gate",
  );
  return { approvalId: approval.id };
}
