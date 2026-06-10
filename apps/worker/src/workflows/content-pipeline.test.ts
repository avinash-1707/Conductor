import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  blogPostPipelineOutputSchema,
  type ApprovalSignalPayload,
  type BlogDraft,
  type BlogPostPipelineInput,
  type ResearchFindings,
} from "@conductor/shared";
import { approvalDecisionSignal, contentPipeline, runStateQuery } from "./content-pipeline";

/**
 * Time-skipping workflow tests (code-standards Testing): happy path, retry on
 * a failing activity, reject path, and 24h expiry — the expiry uses skipped
 * time, never real time. Activities are mocked per test; the workflow bundle
 * is built once and shared.
 */

const input: BlogPostPipelineInput = {
  topic: "How durable workflows prevent lost AI runs",
  keywords: ["durable execution", "temporal"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_approver",
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
  writeCalls: number;
  publishCalls: number;
}

function makeMocks(opts: { researchFailuresBeforeSuccess?: number } = {}) {
  const tracker: MockTracker = { researchAttempts: 0, writeCalls: 0, publishCalls: 0 };
  const failures = opts.researchFailuresBeforeSuccess ?? 0;
  const activities = {
    research: async (): Promise<ResearchFindings> => {
      tracker.researchAttempts += 1;
      if (tracker.researchAttempts <= failures) {
        throw new Error("transient mock research failure");
      }
      return findings;
    },
    requestApproval: async () => ({ requested: true as const }),
    writeDraft: async (): Promise<BlogDraft> => {
      tracker.writeCalls += 1;
      return draft;
    },
    publish: async () => {
      tracker.publishCalls += 1;
      return { deliveredAt: "2026-06-10T12:34:56.000Z" };
    },
  };
  return { tracker, activities };
}

describe("contentPipeline", () => {
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

  it("completes after an approved signal (happy path)", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-content-happy";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(contentPipeline, {
        taskQueue,
        workflowId: "content-happy",
        args: [input],
      });
      await handle.signal(approvalDecisionSignal, approvedPayload);
      const result = await handle.result();

      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(blogPostPipelineOutputSchema.safeParse(result.output).success).toBe(true);
        expect(result.output.draft).toEqual(draft);
      }
      expect(await handle.query(runStateQuery)).toEqual({
        status: "completed",
        currentStep: null,
      });
    });
    expect(tracker.researchAttempts).toBe(1);
    expect(tracker.publishCalls).toBe(1);
  });

  it("retries a failing research activity and still completes", async () => {
    const { tracker, activities } = makeMocks({ researchFailuresBeforeSuccess: 2 });
    const taskQueue = "test-content-retry";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(contentPipeline, {
        taskQueue,
        workflowId: "content-retry",
        args: [input],
      });
      await handle.signal(approvalDecisionSignal, approvedPayload);
      const result = await handle.result();
      expect(result.status).toBe("completed");
    });
    expect(tracker.researchAttempts).toBe(3);
    expect(tracker.writeCalls).toBe(1);
  });

  it("ends gracefully as rejected and never writes or publishes", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-content-reject";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(contentPipeline, {
        taskQueue,
        workflowId: "content-reject",
        args: [input],
      });
      await handle.signal(approvalDecisionSignal, {
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
    expect(tracker.writeCalls).toBe(0);
    expect(tracker.publishCalls).toBe(0);
  });

  it("expires after 24h of skipped time with no decision", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-content-expiry";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(contentPipeline, {
        taskQueue,
        workflowId: "content-expiry",
        args: [input],
      });
      // No signal — the time-skipping environment jumps past the 24h timer.
      const result = await handle.result();
      expect(result).toEqual({ status: "expired" });
    });
    expect(tracker.researchAttempts).toBe(1);
    expect(tracker.writeCalls).toBe(0);
    expect(tracker.publishCalls).toBe(0);
  });
});
