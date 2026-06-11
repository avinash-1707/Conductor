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
  activityRegistry,
  approvalSignalPayloadSchema,
  executionOrder,
  interpreterInputSchema,
  templateCatalog,
  type ApprovalSignalPayload,
  type BlogDraft,
  type GraphNode,
  type InterpreterInput,
  type InterpreterResult,
  type ResearchFindings,
  type RunState,
  type StepKind,
} from "@conductor/shared";
// Type-only import: activity implementations must never be bundled into the
// deterministic workflow sandbox (code-standards Temporal; invariant 1).
import type * as activities from "../activities";

/**
 * The generic interpreter (Unit 25, generalized in Unit 26): walks a validated
 * graph_spec in chain order, dispatching the registered activity per node type
 * with that node's own timeout/retry config, and running the approval node
 * with the same signal + condition() gate as ever (invariant 3). One engine,
 * two authoring surfaces — every template launch and resume executes here; the
 * hardcoded contentPipeline is retired (Unit 26).
 *
 * Resume-from-step is channel-based: an activity node is skipped when its
 * `produces` channel was pre-supplied by the server from the failed run's
 * stored outputs (so publish — which produces nothing — always executes), and
 * the gate is skipped only when the prior run's gate was approved.
 *
 * Deterministic throughout: spec validation, chain ordering, and the template
 * catalog are pure shared data/helpers; all clocks, randomness, and I/O live
 * in activities.
 */

type StepActivities = Pick<typeof activities, "research" | "writeDraft" | "publish">;
type ActivityNode = Exclude<GraphNode, { type: "approval" }>;

/**
 * Per-node activity options: the node's config over the registry defaults,
 * with the same backoff shape as the retired hardcoded workflow.
 * proxyActivities is a deterministic proxy factory — one per node is
 * sandbox-safe.
 */
function stepProxy(node: ActivityNode): StepActivities {
  const config = { ...activityRegistry[node.type].defaults, ...node.config };
  return proxyActivities<StepActivities>({
    startToCloseTimeout: `${config.timeoutSeconds} seconds`,
    retry: {
      initialInterval: "1 second",
      backoffCoefficient: 2,
      maximumInterval: "30 seconds",
      maximumAttempts: config.maximumAttempts,
    },
  });
}

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

export const interpreterApprovalSignal = defineSignal<[ApprovalSignalPayload]>(
  SIGNALS.APPROVAL_DECISION,
);
export const interpreterRunStateQuery = defineQuery<RunState>(QUERIES.RUN_STATE);

/** Root-cause message from a Temporal-wrapped error (cause chain bottom). */
function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let current: Error = err;
  while (current.cause instanceof Error) current = current.cause;
  return current.message;
}

/** The interpreter's node types map 1:1 onto projection step kinds; the gate is not a step. */
function toFailedStep(step: RunState["currentStep"]): StepKind | undefined {
  return step === null || step === "approval" ? undefined : step;
}

/** Defensive channel guard — validation already proves order (missing_channel). */
function requireChannel<T>(value: T | undefined, node: GraphNode, channel: string): T {
  if (value === undefined) {
    throw ApplicationFailure.nonRetryable(
      `Graph node "${node.id}" (${node.type}) consumes channel "${channel}" before it was produced`,
      "InvalidGraphSpec",
    );
  }
  return value;
}

export async function interpreterWorkflow(
  input: InterpreterInput,
): Promise<InterpreterResult> {
  const parsedInput = interpreterInputSchema.safeParse(input);
  if (!parsedInput.success) {
    // Invalid input (a structurally invalid spec or params that violate the
    // template's parameter schema — the input schema re-runs both) fails the
    // run immediately, before any activity is called.
    throw ApplicationFailure.nonRetryable(
      `Invalid interpreter input: ${parsedInput.error.message}`,
      "InvalidWorkflowInput",
    );
  }
  const { orgId, spec, params, resumeFrom } = parsedInput.data;
  // v1 has exactly one template family; the catalog parse gives the dispatchers
  // their typed parameters (already proven valid by the input schema). How a
  // future template's params map onto its nodes is Unit 29's question.
  const blogParams = templateCatalog["blog-post-pipeline"].paramsSchema.parse(params);
  const order = executionOrder(spec);

  let decision: ApprovalSignalPayload | undefined;
  let state: RunState = { status: "running", currentStep: order[0]?.type ?? null };

  setHandler(interpreterApprovalSignal, (payload) => {
    // First valid decision wins; later or malformed signals are ignored.
    if (decision !== undefined) return;
    const parsed = approvalSignalPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      log.warn("Ignoring malformed approvalDecision signal payload");
      return;
    }
    decision = parsed.data;
  });
  setHandler(interpreterRunStateQuery, () => state);

  /** Best-effort terminal projection write (invariant 4 — never fails a run). */
  async function recordTerminal(
    terminal: Parameters<typeof recordRunTerminal>[0],
  ): Promise<void> {
    try {
      await recordRunTerminal(terminal);
    } catch (err) {
      log.warn("recordRunTerminal projection write failed", {
        error: errorMessage(err),
      });
    }
  }

  // Anchor the run projection before any node runs (steps require the row).
  // workflowName = the spec's name: customer vocabulary, what the dashboard shows.
  await recordRunStarted({ orgId, workflowName: spec.name, input: params });

  // The run's data channels — the registry's produces/consumes model. A resume
  // pre-seeds them with the prior run's carried outputs (Unit 22 semantics).
  const channels: { research?: ResearchFindings; draft?: BlogDraft } = {
    ...resumeFrom?.channels,
  };
  let output: InterpreterResult & { status: "completed" } = { status: "completed" };

  try {
    for (const node of order) {
      if (node.type === "approval") {
        // A resume whose prior gate was approved carries that approval — a
        // human already decided; re-asking would redo completed human work.
        if (resumeFrom?.gateApproved) continue;
        state = { status: "suspended", currentStep: "approval" };
        const findings = requireChannel(channels.research, node, "research");
        // Short record-write; the human wait is the signal + condition below
        // (invariant 3 — no activity ever blocks on a person).
        await createApprovalRequest({
          orgId,
          approverId: blogParams.approverId,
          context: { research: findings },
        });
        const timeoutHours = node.config.timeoutHours ?? activityRegistry.approval.defaults.timeoutHours;
        await condition(() => decision !== undefined, `${timeoutHours} hours`);

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
        continue;
      }

      // Channel-based resume skip: this node's output was carried over from
      // the failed run — never re-execute completed work or re-spend tokens.
      // A node that produces nothing (publish) always executes: a
      // resumed-at-publish run never delivered.
      const produces = activityRegistry[node.type].produces;
      if (produces && channels[produces] !== undefined) continue;

      state = { status: "running", currentStep: node.type };
      const proxy = stepProxy(node);

      if (node.type === "research") {
        channels.research = await proxy.research({
          orgId,
          topic: blogParams.topic,
          keywords: blogParams.keywords,
          tone: blogParams.tone,
        });
      } else if (node.type === "write") {
        const findings = requireChannel(channels.research, node, "research");
        channels.draft = await proxy.writeDraft({
          orgId,
          topic: blogParams.topic,
          keywords: blogParams.keywords,
          tone: blogParams.tone,
          wordCount: blogParams.wordCount,
          findings,
        });
      } else {
        const draft = requireChannel(channels.draft, node, "draft");
        // Run-scoped idempotency key — a publish retry delivers exactly once.
        const receipt = await proxy.publish({
          orgId,
          draft,
          idempotencyKey: workflowInfo().workflowId,
        });
        output = {
          status: "completed",
          output: {
            draft,
            publishedUrl: receipt.publishedUrl,
            deliveredAt: receipt.deliveredAt,
          },
        };
      }
    }

    state = { status: "completed", currentStep: null };
    await recordTerminal({ orgId, status: "completed", output: output.output });
    return output;
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
