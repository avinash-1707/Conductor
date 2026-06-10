import { ApplicationFailure, Context } from "@temporalio/activity";

/**
 * Narrows the activity Context to the fields projection tracking needs. The
 * SDK types `workflowExecution` as optional, but every activity dispatched by
 * a workflow has it — its absence means the activity is being invoked outside
 * a workflow, which is a permanent misuse, not a transient failure.
 */
export function workflowExecutionContext(): {
  workflowId: string;
  runId: string;
  attempt: number;
  activityType: string;
} {
  const { info } = Context.current();
  const execution = info.workflowExecution;
  if (!execution) {
    throw ApplicationFailure.nonRetryable(
      "Activity is missing its workflow execution context",
      "MissingWorkflowContext",
    );
  }
  return {
    workflowId: execution.workflowId,
    runId: execution.runId,
    attempt: info.attempt,
    activityType: info.activityType,
  };
}
