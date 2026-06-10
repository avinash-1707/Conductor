import { ApplicationFailure } from "@temporalio/activity";
import type { z } from "zod";
import type { StepKind } from "@conductor/shared";
import { repos } from "../db";
import { logger } from "../logger";
import { workflowExecutionContext } from "./activity-context";

/**
 * Wraps a pipeline-step activity with `activity_log` / `workflow_runs`
 * projection tracking (code-standards Temporal: use this helper, never
 * hand-roll tracking). Per attempt:
 *
 * - parse the input (invalid → non-retryable, the contract for every activity),
 * - resolve the run projection by `(orgId, temporal workflow id)` — the row is
 *   guaranteed by `recordRunStarted`, which the workflow runs first,
 * - record the attempt start (`running`, attempt number, input payload) and
 *   bump the run to `running` (covers the resume after an approval gate) —
 *   these fail loud: nothing expensive has run yet, retrying is cheap,
 * - on success, record `completed` + output — BEST-EFFORT: a projection write
 *   failure is logged, never thrown, so a finished LLM step is never re-run
 *   (and its tokens never re-spent) because a read-side row hiccuped,
 * - on failure, record `retrying` (or `failed` for non-retryable errors) +
 *   the error message — best-effort, then rethrow the ORIGINAL error so the
 *   projection can never mask the real failure.
 *
 * The retries-exhausted edge (last attempt leaves the row `retrying`) is
 * reconciled by the workflow's catch → `recordRunTerminal({ failedStep })`.
 */
export function withStepTracking<I extends { orgId: string }, O>(
  stepKind: StepKind,
  inputSchema: z.ZodType<I>,
  fn: (input: I) => Promise<O>,
): (input: I) => Promise<O> {
  return async (rawInput: I): Promise<O> => {
    const parsed = inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw ApplicationFailure.nonRetryable(
        `Invalid ${stepKind} input: ${parsed.error.message}`,
        "InvalidActivityInput",
      );
    }
    const input = parsed.data;
    const { workflowId: temporalWorkflowId, attempt, activityType } =
      workflowExecutionContext();
    const log = logger.child({
      activity: activityType,
      stepKind,
      attempt,
      orgId: input.orgId,
      temporalWorkflowId,
    });

    const run = await repos.runs.findRunByTemporalId({
      orgId: input.orgId,
      temporalWorkflowId,
    });
    if (!run) {
      // recordRunStarted precedes every tracked step, so a missing row is
      // transient — throw normally and let the retry policy work.
      throw new Error(
        `workflow_runs projection row missing for workflow ${temporalWorkflowId}`,
      );
    }

    await repos.activityLog.startStepAttempt({
      orgId: input.orgId,
      runId: run.id,
      stepKind,
      attempt,
      input,
    });
    await repos.runs.markRunStatus({
      orgId: input.orgId,
      temporalWorkflowId,
      status: "running",
    });

    try {
      const output = await fn(input);
      try {
        await repos.activityLog.completeStep({
          orgId: input.orgId,
          runId: run.id,
          stepKind,
          output,
        });
      } catch (projectionErr) {
        log.error({ err: projectionErr }, "step completion projection write failed");
      }
      return output;
    } catch (err) {
      const terminal = err instanceof ApplicationFailure && err.nonRetryable === true;
      try {
        await repos.activityLog.failStepAttempt({
          orgId: input.orgId,
          runId: run.id,
          stepKind,
          error: err instanceof Error ? err.message : String(err),
          terminal,
        });
      } catch (projectionErr) {
        log.error({ err: projectionErr }, "step failure projection write failed");
      }
      throw err;
    }
  };
}
