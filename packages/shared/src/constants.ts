/**
 * Cross-boundary constants shared by server and worker. Signal/query/queue
 * names and Redis channel keys live ONLY here so both sides reference the
 * identical strings (code-standards.md; architecture invariant 5).
 */

/** Temporal task queue the worker listens on and the server starts runs on. */
export const TASK_QUEUE = "conductor-content" as const;

/** Workflow signal names. */
export const SIGNALS = {
  /** Carries an ApprovalSignalPayload to resume a suspended run. */
  APPROVAL_DECISION: "approvalDecision",
} as const;

/** Workflow query names. */
export const QUERIES = {
  /** Returns the current run/step state for debugging and reconnection. */
  RUN_STATE: "runState",
} as const;

/** Redis pub/sub channel builders (ephemeral; architecture storage model). */
export const redisChannels = {
  /** Step/run status events for the dashboard. */
  status: (runId: string) => `run:${runId}:status`,
  /** LLM token stream for the active step. */
  stream: (runId: string) => `run:${runId}:stream`,
} as const;
