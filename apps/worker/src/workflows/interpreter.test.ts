import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GRAPH_SPEC_VERSION,
  blogPostPipelineOutputSchema,
  blogPostPipelineSpec,
  graphSpecSchema,
  seoBriefSpec,
  templateCatalog,
  type ApprovalSignalPayload,
  type BlogDraft,
  type BlogPostPipelineInput,
  type GraphSpec,
  type InterpreterInput,
  type ResearchFindings,
} from "@conductor/shared";
import type { RecordRunTerminalInput } from "../activities/projections";
import type { CreateApprovalRequestInput } from "../activities/approvals";
import {
  interpreterApprovalSignal,
  interpreterRunStateQuery,
  interpreterWorkflow,
} from "./interpreter";

/**
 * Time-skipping interpreter tests (Unit 25, extended in Unit 26) — mirrors the
 * Unit 04 suite but driven by a graph spec (build-plan Verify): happy path,
 * retry, reject, 24h expiry with skipped time, retries-exhausted failure,
 * per-node retry config, and the Unit 22 resume proofs by call count
 * (channel-based resume: carried steps never re-execute; publish always runs).
 * The hardcoded contentPipeline (and the Unit 25 equivalence test against it)
 * was retired in Unit 26 — the golden-path E2E is the behavioral regression net.
 */

const params: BlogPostPipelineInput = {
  topic: "How durable workflows prevent lost AI runs",
  keywords: ["durable execution", "temporal"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_approver",
};

const input: InterpreterInput = {
  orgId: "org-1",
  templateKey: "blog-post-pipeline",
  spec: blogPostPipelineSpec,
  params,
};

const findings: ResearchFindings = {
  summary: "Mock research summary.",
  sources: [
    { title: "Mock source", url: "https://example.com/mock", takeaway: "Mock takeaway." },
  ],
  keyPoints: ["Mock key point"],
};

const draft: BlogDraft = { title: "Mock draft", markdown: "# Mock", wordCount: 1200 };

const approvedPayload: ApprovalSignalPayload = {
  decision: "approved",
  reviewerId: "user_approver",
  decidedAt: "2026-06-10T12:00:00.000Z",
};

interface MockTracker {
  researchAttempts: number;
  researchInputs: unknown[];
  writeCalls: number;
  writeInputs: unknown[];
  publishCalls: number;
  runStarted: { workflowName: string }[];
  approvalRequests: CreateApprovalRequestInput[];
  terminal: RecordRunTerminalInput[];
}

function makeMocks(opts: { researchFailuresBeforeSuccess?: number } = {}) {
  const tracker: MockTracker = {
    researchAttempts: 0,
    researchInputs: [],
    writeCalls: 0,
    writeInputs: [],
    publishCalls: 0,
    runStarted: [],
    approvalRequests: [],
    terminal: [],
  };
  const failures = opts.researchFailuresBeforeSuccess ?? 0;
  const activities = {
    research: async (researchInput: unknown): Promise<ResearchFindings> => {
      tracker.researchAttempts += 1;
      tracker.researchInputs.push(researchInput);
      if (tracker.researchAttempts <= failures) {
        throw new Error("transient mock research failure");
      }
      return findings;
    },
    createApprovalRequest: async (approvalInput: CreateApprovalRequestInput) => {
      tracker.approvalRequests.push(approvalInput);
      return { approvalId: "2c8e7a1e-1111-4222-8333-444455556666" };
    },
    writeDraft: async (writeInput: unknown): Promise<BlogDraft> => {
      tracker.writeCalls += 1;
      tracker.writeInputs.push(writeInput);
      return draft;
    },
    publish: async () => {
      tracker.publishCalls += 1;
      return { deliveredAt: "2026-06-10T12:34:56.000Z" };
    },
    recordRunStarted: async (started: { workflowName: string }) => {
      tracker.runStarted.push(started);
      return { runId: "0c8e7a1e-1111-4222-8333-444455556666" };
    },
    recordRunTerminal: async (terminalInput: RecordRunTerminalInput) => {
      tracker.terminal.push(terminalInput);
      return { ok: true as const };
    },
  };
  return { tracker, activities };
}

/** A blog chain with research's retry policy tightened to 2 attempts. */
const tightRetrySpec: GraphSpec = graphSpecSchema.parse({
  specVersion: GRAPH_SPEC_VERSION,
  name: "Blog Post Pipeline",
  nodes: blogPostPipelineSpec.nodes.map((n) =>
    n.type === "research" ? { ...n, config: { maximumAttempts: 2 } } : n,
  ),
  edges: blogPostPipelineSpec.edges,
});

describe("interpreterWorkflow", () => {
  let testEnv: TestWorkflowEnvironment;
  let workflowBundle: Awaited<ReturnType<typeof bundleWorkflowCode>>;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    workflowBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(new URL("./index.ts", import.meta.url)),
    });
  });

  afterAll(async () => {
    await testEnv?.teardown();
  });

  async function runWorker<T>(
    taskQueue: string,
    activities: ReturnType<typeof makeMocks>["activities"],
    fn: () => Promise<T>,
  ): Promise<T> {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowBundle,
      activities,
    });
    return worker.runUntil(fn);
  }

  it("walks the blog spec to completion after an approved signal (happy path)", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-interpreter-happy";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-happy",
        args: [input],
      });
      await handle.signal(interpreterApprovalSignal, approvedPayload);
      const result = await handle.result();

      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(blogPostPipelineOutputSchema.safeParse(result.output).success).toBe(true);
        expect(result.output?.draft).toEqual(draft);
      }
      expect(await handle.query(interpreterRunStateQuery)).toEqual({
        status: "completed",
        currentStep: null,
      });
    });
    expect(tracker.researchAttempts).toBe(1);
    expect(tracker.writeCalls).toBe(1);
    expect(tracker.publishCalls).toBe(1);
    // The projection anchors under the spec's (customer-facing) name.
    expect(tracker.runStarted[0]).toMatchObject({ workflowName: "Blog Post Pipeline" });
    // The gate record carries the completed draft so approval explicitly authorizes publishing.
    expect(tracker.approvalRequests).toHaveLength(1);
    expect(tracker.approvalRequests[0]).toMatchObject({
      orgId: "org-1",
      approverId: params.approverId,
      context: { research: findings, draft },
    });
    expect(tracker.terminal).toHaveLength(1);
    expect(tracker.terminal[0]).toMatchObject({ orgId: "org-1", status: "completed" });
  });

  it("retries a failing research activity and still completes", async () => {
    const { tracker, activities } = makeMocks({ researchFailuresBeforeSuccess: 2 });
    const taskQueue = "test-interpreter-retry";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-retry",
        args: [input],
      });
      await handle.signal(interpreterApprovalSignal, approvedPayload);
      const result = await handle.result();
      expect(result.status).toBe("completed");
    });
    expect(tracker.researchAttempts).toBe(3);
    expect(tracker.writeCalls).toBe(1);
  });

  it("records a failed run when research exhausts the default 5 attempts", async () => {
    const { tracker, activities } = makeMocks({ researchFailuresBeforeSuccess: 99 });
    const taskQueue = "test-interpreter-failure";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-failure",
        args: [input],
      });
      await expect(handle.result()).rejects.toThrow();
    });
    // Registry default — same as the hardcoded workflow's proxy options.
    expect(tracker.researchAttempts).toBe(5);
    expect(tracker.writeCalls).toBe(0);
    expect(tracker.terminal).toHaveLength(1);
    expect(tracker.terminal[0]).toMatchObject({
      status: "failed",
      failedStep: "research",
    });
    expect(tracker.terminal[0]?.error).toContain("transient mock research failure");
  });

  it("honors per-node retry config (research capped at 2 attempts)", async () => {
    const { tracker, activities } = makeMocks({ researchFailuresBeforeSuccess: 99 });
    const taskQueue = "test-interpreter-node-config";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-node-config",
        args: [{ ...input, spec: tightRetrySpec }],
      });
      await expect(handle.result()).rejects.toThrow();
    });
    expect(tracker.researchAttempts).toBe(2);
    expect(tracker.terminal[0]).toMatchObject({ status: "failed", failedStep: "research" });
  });

  it("ends gracefully as rejected after drafting and never publishes", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-interpreter-reject";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-reject",
        args: [input],
      });
      await handle.signal(interpreterApprovalSignal, {
        ...approvedPayload,
        decision: "rejected",
      });
      const result = await handle.result();

      expect(result).toEqual({
        status: "rejected",
        reviewerId: approvedPayload.reviewerId,
        decidedAt: approvedPayload.decidedAt,
      });
    });
    expect(tracker.writeCalls).toBe(1);
    expect(tracker.publishCalls).toBe(0);
    expect(tracker.terminal).toHaveLength(1);
    expect(tracker.terminal[0]).toMatchObject({ status: "rejected" });
  });

  it("expires after 24h of skipped time with no decision", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-interpreter-expiry";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-expiry",
        args: [input],
      });
      // No signal — the time-skipping environment jumps past the 24h timer.
      const result = await handle.result();
      expect(result).toEqual({ status: "expired" });
    });
    expect(tracker.researchAttempts).toBe(1);
    expect(tracker.writeCalls).toBe(1);
    expect(tracker.publishCalls).toBe(0);
    expect(tracker.terminal).toHaveLength(1);
    expect(tracker.terminal[0]).toMatchObject({ status: "expired" });
  });

  it("expires on a custom gate timeout (config plumbed to the condition timer)", async () => {
    const gateSpec = graphSpecSchema.parse({
      specVersion: GRAPH_SPEC_VERSION,
      name: "Blog Post Pipeline",
      nodes: blogPostPipelineSpec.nodes.map((n) =>
        n.type === "approval" ? { ...n, config: { timeoutHours: 1 } } : n,
      ),
      edges: blogPostPipelineSpec.edges,
    });
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-interpreter-gate-config";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-gate-config",
        args: [{ ...input, spec: gateSpec }],
      });
      const result = await handle.result();
      expect(result).toEqual({ status: "expired" });
    });
    expect(tracker.terminal[0]).toMatchObject({ status: "expired" });
  });

  it("fails non-retryably on an invalid spec without calling any activity", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-interpreter-invalid";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-invalid",
        args: [
          {
            ...input,
            // write before research — missing_channel at validation.
            spec: {
              specVersion: GRAPH_SPEC_VERSION,
              name: "Broken",
              nodes: [
                { id: "write", type: "write", config: {} },
                { id: "publish", type: "publish", config: {} },
              ],
              edges: [{ from: "write", to: "publish" }],
            } as GraphSpec,
          },
        ],
      });
      await expect(handle.result()).rejects.toThrow();
    });
    expect(tracker.researchAttempts).toBe(0);
    expect(tracker.writeCalls).toBe(0);
    expect(tracker.publishCalls).toBe(0);
    expect(tracker.runStarted).toHaveLength(0);
    expect(tracker.terminal).toHaveLength(0);
  });
  it("resume with carried research + approved gate skips research and the gate (call counts)", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-interpreter-resume-write";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-resume-write",
        args: [
          {
            ...input,
            resumeFrom: { channels: { research: findings }, gateApproved: true },
          },
        ],
      });
      // No signal needed — the approved gate is carried over.
      const result = await handle.result();
      expect(result.status).toBe("completed");
    });
    expect(tracker.researchAttempts).toBe(0);
    expect(tracker.approvalRequests).toHaveLength(0);
    expect(tracker.writeCalls).toBe(1);
    // The write step consumes the CARRIED findings, not a re-run's.
    expect(tracker.writeInputs[0]).toMatchObject({ findings });
    expect(tracker.publishCalls).toBe(1);
    expect(tracker.terminal[0]).toMatchObject({ status: "completed" });
  });

  it("resume at publish skips research, gate, and write — publish always runs", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-interpreter-resume-publish";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-resume-publish",
        args: [
          {
            ...input,
            resumeFrom: {
              channels: { research: findings, draft },
              gateApproved: true,
            },
          },
        ],
      });
      const result = await handle.result();
      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        // The deliverable is built from the carried draft.
        expect(result.output?.draft).toEqual(draft);
      }
    });
    expect(tracker.researchAttempts).toBe(0);
    expect(tracker.approvalRequests).toHaveLength(0);
    expect(tracker.writeCalls).toBe(0);
    expect(tracker.publishCalls).toBe(1);
  });

  it("resume with an unapproved prior gate re-runs the gate with the carried findings", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-interpreter-resume-gate";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-resume-gate",
        args: [
          {
            ...input,
            resumeFrom: { channels: { research: findings }, gateApproved: false },
          },
        ],
      });
      await handle.signal(interpreterApprovalSignal, approvedPayload);
      const result = await handle.result();
      expect(result.status).toBe("completed");
    });
    expect(tracker.researchAttempts).toBe(0);
    // The gate re-asks, presenting the carried research context.
    expect(tracker.approvalRequests).toHaveLength(1);
    expect(tracker.approvalRequests[0]).toMatchObject({
      context: { research: findings },
    });
    expect(tracker.writeCalls).toBe(1);
    expect(tracker.publishCalls).toBe(1);
  });
  it("dispatches a seo-brief template through the catalog engine mapping (Unit 29)", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-interpreter-seo";
    const seoParams = {
      targetKeyword: "ai workflow automation",
      secondaryKeywords: ["durable ai pipelines"],
      audience: "Heads of content at B2B agencies",
      approverId: "user_seo_approver",
    };

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(interpreterWorkflow, {
        taskQueue,
        workflowId: "interpreter-seo",
        args: [
          {
            orgId: "org-1",
            templateKey: "seo-brief",
            spec: seoBriefSpec,
            params: seoParams,
          },
        ],
      });
      await handle.signal(interpreterApprovalSignal, approvedPayload);
      const result = await handle.result();
      expect(result.status).toBe("completed");
    });
    // Research receives the MAPPED engine params, not the raw template params.
    const engine = templateCatalog["seo-brief"].toEngineParams(seoParams);
    expect(tracker.researchInputs[0]).toMatchObject({
      topic: engine.topic,
      keywords: engine.keywords,
      tone: "professional",
    });
    // The gate is addressed to the mapped approver; the projection anchors
    // under the template's customer-facing name.
    expect(tracker.approvalRequests[0]).toMatchObject({
      approverId: "user_seo_approver",
    });
    expect(tracker.runStarted[0]).toMatchObject({ workflowName: "SEO Brief" });
    expect(tracker.writeInputs[0]).toMatchObject({ wordCount: 800 });
  });
});
