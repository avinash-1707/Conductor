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

/**
 * Platform-default OpenRouter model slugs (Unit 33). Single source for the
 * worker's env defaults and the server's defaults exposure — an org override
 * in `org_model_settings` wins; these are the fallback.
 */
export const DEFAULT_RESEARCH_MODEL = "anthropic/claude-sonnet-4.5" as const;
export const DEFAULT_WRITING_MODEL = "anthropic/claude-opus-4.8" as const;

/** Redis pub/sub channel builders (ephemeral; architecture storage model). */
export const redisChannels = {
  /** Step/run status events for the dashboard. */
  status: (runId: string) => `run:${runId}:status`,
  /** LLM token stream for the active step. */
  stream: (runId: string) => `run:${runId}:stream`,
} as const;

/** Redis cache keys (ephemeral — Postgres stays the source of truth). */
export const redisKeys = {
  /** Cached org model settings (Unit 33): worker reads through it, server DELs on update. */
  orgModelSettings: (orgId: string) => `org:${orgId}:model-settings`,
} as const;

/** Cache TTL for org model settings (10 min — operator decision, Unit 33). */
export const ORG_MODEL_SETTINGS_TTL_SECONDS = 600;
