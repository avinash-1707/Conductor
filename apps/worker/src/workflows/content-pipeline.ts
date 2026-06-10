import {
  ApplicationFailure,
  condition,
  defineQuery,
  defineSignal,
  isCancellation,
  log,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import {
  SIGNALS,
  QUERIES,
  contentPipelineInputSchema,
  approvalSignalPayloadSchema,
  type ApprovalSignalPayload,
  type ContentPipelineInput,
  type ContentPipelineResult,
  type RunState,
  type StepKind,
} from "@conductor/shared";
// Type-only import: activity implementations must never be bundled into the
// deterministic workflow sandbox (code-standards Temporal; invariant 1).
import type * as activities from "../activities";

/** Reviewers get 24 hours before the gate expires (project-overview HITL). */
const APPROVAL_TIMEOUT = "24h";

// Explicit timeout + retry per activity group — no defaults (code-standards).
const { research, writeDraft, publish } = proxyActivities<typeof activities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

// Short record-writes (approval request + run projections) — never a human
// wait (invariant 3): tighter timeout, same backoff.
const { createApprovalRequest, recordRunStarted, recordRunTerminal } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "10 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "10 seconds",
    maximumAttempts: 5,
  },
});

export const approvalDecisionSignal = defineSignal<[ApprovalSignalPayload]>(
  SIGNALS.APPROVAL_DECISION,
);
export const runStateQuery = defineQuery<RunState>(QUERIES.RUN_STATE);

/**
 * Extracts the most specific message from a (possibly Temporal-wrapped)
 * error: an ActivityFailure's message is the generic "Activity task failed";
 * the activity's real error lives at the bottom of the `cause` chain.
 */
function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let current: Error = err;
  while (current.cause instanceof Error) current = current.cause;
  return current.message;
}

/**
 * Best-effort terminal projection write: a run that already delivered (or
 * gracefully ended) must never fail because a read-side row could not be
 * updated. Temporal history stays the execution source of truth (invariant 4).
 */
async function recordTerminal(
  input: Parameters<typeof recordRunTerminal>[0],
): Promise<void> {
  try {
    await recordRunTerminal(input);
  } catch (err) {
    log.warn("recordRunTerminal projection write failed", {
      error: errorMessage(err),
    });
  }
}

/** Maps the gate-aware pipeline step to a projection step kind (no `approval`). */
function toFailedStep(step: RunState["currentStep"]): StepKind | undefined {
  return step === null || step === "approval" ? undefined : step;
}

/**
 * The content pipeline: research → approval gate → write → publish.
 * Deterministic — all clocks, randomness, and I/O live in activities. The
 * gate is a signal handler + condition() with a 24h timer; rejection and
 * expiry are graceful terminal results, not failures. Every terminal point
 * (and the run start) is mirrored into the Postgres projections (Unit 12).
 */
export async function contentPipeline(
  input: ContentPipelineInput,
): Promise<ContentPipelineResult> {
  const parsedInput = contentPipelineInputSchema.safeParse(input);
  if (!parsedInput.success) {
    // Invalid input must fail the run immediately — never burn retries on it.
    throw ApplicationFailure.nonRetryable(
      `Invalid contentPipeline input: ${parsedInput.error.message}`,
      "InvalidWorkflowInput",
    );
  }
  const { orgId, topic, keywords, tone, wordCount, approverId } = parsedInput.data;

  let decision: ApprovalSignalPayload | undefined;
  let state: RunState = { status: "running", currentStep: "research" };

  setHandler(approvalDecisionSignal, (payload) => {
    // First valid decision wins; later or malformed signals are ignored.
    if (decision !== undefined) return;
    const parsed = approvalSignalPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.warn("Ignoring malformed approvalDecision signal payload");
      return;
    }
    decision = parsed.data;
  });
  setHandler(runStateQuery, () => state);

  // Anchor the run projection before any step runs (steps require the row).
  await recordRunStarted({
    orgId,
    workflowName: "contentPipeline",
    input: { topic, keywords, tone, wordCount, approverId },
  });

  try {
    const findings = await research({ orgId, topic, keywords, tone });

    state = { status: "suspended", currentStep: "approval" };
    // Creates the org-scoped approval record (with the research context the
    // reviewer renders) and suspends the run projection. The wait itself is
    // the signal + condition below — never an activity (invariant 3).
    await createApprovalRequest({
      orgId,
      approverId,
      context: { research: findings },
    });
    await condition(() => decision !== undefined, APPROVAL_TIMEOUT);

    if (decision === undefined) {
      state = { status: "expired", currentStep: null };
      await recordTerminal({ orgId, status: "expired" });
      return { status: "expired" };
    }
    const verdict = decision;
    if (verdict.decision === "rejected") {
      state = { status: "rejected", currentStep: null };
      await recordTerminal({ orgId, status: "rejected" });
      return {
        status: "rejected",
        reviewerId: verdict.reviewerId,
        decidedAt: verdict.decidedAt,
      };
    }

    state = { status: "running", currentStep: "write" };
    const draft = await writeDraft({ orgId, topic, keywords, tone, wordCount, findings });

    state = { status: "running", currentStep: "publish" };
    // Run-scoped idempotency key so a publish retry delivers exactly once.
    const receipt = await publish({
      orgId,
      draft,
      idempotencyKey: workflowInfo().workflowId,
    });

    const output = {
      draft,
      publishedUrl: receipt.publishedUrl,
      deliveredAt: receipt.deliveredAt,
    };
    state = { status: "completed", currentStep: null };
    await recordTerminal({ orgId, status: "completed", output });
    return { status: "completed", output };
  } catch (err) {
    // Cancellation must propagate untouched (Temporal semantics).
    if (isCancellation(err)) throw err;
    const failedStep = toFailedStep(state.currentStep);
    state = { status: "failed", currentStep: state.currentStep };
    await recordTerminal({
      orgId,
      status: "failed",
      error: errorMessage(err),
      failedStep,
    });
    throw err;
  }
}
