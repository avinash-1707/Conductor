import {
  ApplicationFailure,
  condition,
  defineQuery,
  defineSignal,
  log,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import {
  SIGNALS,
  QUERIES,
  blogPostPipelineInputSchema,
  approvalSignalPayloadSchema,
  type ApprovalSignalPayload,
  type BlogPostPipelineInput,
  type ContentPipelineResult,
  type RunState,
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

// The approval-request activity is a short record-write, never a human wait
// (invariant 3) — tighter timeout, same backoff.
const { requestApproval } = proxyActivities<typeof activities>({
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
 * The Phase 1 content pipeline: research → approval gate → write → publish.
 * Deterministic — all clocks, randomness, and I/O live in activities. The
 * gate is a signal handler + condition() with a 24h timer; rejection and
 * expiry are graceful terminal results, not failures.
 */
export async function contentPipeline(
  input: BlogPostPipelineInput,
): Promise<ContentPipelineResult> {
  const parsedInput = blogPostPipelineInputSchema.safeParse(input);
  if (!parsedInput.success) {
    // Invalid input must fail the run immediately — never burn retries on it.
    throw ApplicationFailure.nonRetryable(
      `Invalid contentPipeline input: ${parsedInput.error.message}`,
      "InvalidWorkflowInput",
    );
  }
  const { topic, keywords, tone, wordCount, approverId } = parsedInput.data;

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

  const findings = await research({ topic, keywords, tone });

  state = { status: "suspended", currentStep: "approval" };
  await requestApproval({ approverId, summary: findings.summary });
  await condition(() => decision !== undefined, APPROVAL_TIMEOUT);

  if (decision === undefined) {
    state = { status: "expired", currentStep: null };
    return { status: "expired" };
  }
  const verdict = decision;
  if (verdict.decision === "rejected") {
    state = { status: "rejected", currentStep: null };
    return {
      status: "rejected",
      reviewerId: verdict.reviewerId,
      decidedAt: verdict.decidedAt,
    };
  }

  state = { status: "running", currentStep: "write" };
  const draft = await writeDraft({ topic, findings, tone, wordCount });

  state = { status: "running", currentStep: "publish" };
  const receipt = await publish({ draft });

  state = { status: "completed", currentStep: null };
  return {
    status: "completed",
    output: {
      draft,
      publishedUrl: receipt.publishedUrl,
      deliveredAt: receipt.deliveredAt,
    },
  };
}
