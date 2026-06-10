import { z } from "zod";
import { ApplicationFailure } from "@temporalio/activity";
import {
  blogPostPipelineInputSchema,
  blogPostPipelineOutputSchema,
  stepKindSchema,
} from "@conductor/shared";
import { repos } from "../db";
import { logger } from "../logger";
import { workflowExecutionContext } from "./activity-context";

/**
 * Run-level projection activities (Unit 12). Both are short record-writes
 * keyed by the unique `temporal_workflow_id` (the identifier the workflow
 * knows), idempotent across retries, and org-scoped (invariant 11). They
 * mirror Temporal history for dashboard reads — nothing ever reads them to
 * make an execution decision (invariant 4).
 */

export const recordRunStartedInputSchema = z.object({
  orgId: z.string().min(1),
  workflowName: z.string().min(1),
  input: blogPostPipelineInputSchema,
});
export type RecordRunStartedInput = z.infer<typeof recordRunStartedInputSchema>;

export const recordRunStartedOutputSchema = z.object({ runId: z.uuid() });
export type RecordRunStartedOutput = z.infer<typeof recordRunStartedOutputSchema>;

/**
 * Anchors the run projection: upserts the `workflow_runs` row as `running`.
 * Converges with the `pending` row the server pre-creates when it starts the
 * run (Unit 13); `started_at` is preserved across retries.
 */
export async function recordRunStarted(
  input: RecordRunStartedInput,
): Promise<RecordRunStartedOutput> {
  const parsed = recordRunStartedInputSchema.safeParse(input);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      `Invalid recordRunStarted input: ${parsed.error.message}`,
      "InvalidActivityInput",
    );
  }
  const execution = workflowExecutionContext();
  const run = await repos.runs.ensureRunStarted({
    orgId: parsed.data.orgId,
    temporalWorkflowId: execution.workflowId,
    temporalRunId: execution.runId,
    workflowName: parsed.data.workflowName,
    input: parsed.data.input,
  });
  return { runId: run.id };
}

export const recordRunTerminalInputSchema = z.object({
  orgId: z.string().min(1),
  status: z.enum(["completed", "failed", "rejected", "expired"]),
  output: blogPostPipelineOutputSchema.optional(),
  error: z.string().optional(),
  /** Set on failures so the in-flight step row flips `retrying` → `failed`. */
  failedStep: stepKindSchema.optional(),
});
export type RecordRunTerminalInput = z.infer<typeof recordRunTerminalInputSchema>;

export const recordRunTerminalOutputSchema = z.object({ ok: z.literal(true) });
export type RecordRunTerminalOutput = z.infer<typeof recordRunTerminalOutputSchema>;

/**
 * Records the run's terminal status (+ output or error). Called by the
 * workflow at every terminal point; the workflow swallows a persistent
 * failure here (a projection can never fail a run that already delivered).
 */
export async function recordRunTerminal(
  input: RecordRunTerminalInput,
): Promise<RecordRunTerminalOutput> {
  const parsed = recordRunTerminalInputSchema.safeParse(input);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      `Invalid recordRunTerminal input: ${parsed.error.message}`,
      "InvalidActivityInput",
    );
  }
  const { orgId, status, output, error, failedStep } = parsed.data;
  const temporalWorkflowId = workflowExecutionContext().workflowId;

  const run = await repos.runs.markRunTerminal({
    orgId,
    temporalWorkflowId,
    status,
    output,
    error,
  });
  if (!run) {
    // No projection row — recordRunStarted never landed (it precedes the
    // steps, so this is a mis-started workflow). Log, don't fail the record.
    logger.warn(
      { activity: "recordRunTerminal", orgId, temporalWorkflowId, status },
      "no workflow_runs projection row to mark terminal",
    );
    return { ok: true };
  }
  if (failedStep) {
    await repos.activityLog.failStepAttempt({
      orgId,
      runId: run.id,
      stepKind: failedStep,
      error: error ?? "Step failed",
      terminal: true,
    });
  }
  if (status === "expired" || status === "rejected") {
    // Close a still-pending gate: on expiry nobody decided (the only writer);
    // on rejection the route normally recorded the decision already and this
    // conditional update is a no-op fallback (Unit 14).
    await repos.approvals.closePendingForRun({ orgId, runId: run.id, status });
  }
  return { ok: true };
}
