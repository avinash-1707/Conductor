import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  blogPostPipelineOutputSchema,
  type ApprovalSignalPayload,
  type BlogDraft,
  type ContentPipelineInput,
  type ResearchFindings,
} from "@conductor/shared";
import type { RecordRunTerminalInput } from "../activities/projections";
import type { CreateApprovalRequestInput } from "../activities/approvals";
import { approvalDecisionSignal, contentPipeline, runStateQuery } from "./content-pipeline";

/**
 * Time-skipping workflow tests (code-standards Testing): happy path, retry on
 * a failing activity, reject path, 24h expiry, and the retries-exhausted
 * failure path — the expiry uses skipped time, never real time. Activities are
 * mocked per test; the workflow bundle is built once and shared. Terminal
 * projection recording (Unit 12) is asserted through the recordRunTerminal mock.
 */

const input: ContentPipelineInput = {
  orgId: "org-1",
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
  writeInputs: unknown[];
  publishCalls: number;
  runStarted: number;
  approvalRequests: CreateApprovalRequestInput[];
  terminal: RecordRunTerminalInput[];
}

function makeMocks(opts: { researchFailuresBeforeSuccess?: number } = {}) {
  const tracker: MockTracker = {
    researchAttempts: 0,
    writeCalls: 0,
    writeInputs: [],
    publishCalls: 0,
    runStarted: 0,
    approvalRequests: [],
    terminal: [],
  };
  const failures = opts.researchFailuresBeforeSuccess ?? 0;
  const activities = {
    research: async (): Promise<ResearchFindings> => {
      tracker.researchAttempts += 1;
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
    recordRunStarted: async () => {
      tracker.runStarted += 1;
      return { runId: "0c8e7a1e-1111-4222-8333-444455556666" };
    },
    recordRunTerminal: async (terminalInput: RecordRunTerminalInput) => {
      tracker.terminal.push(terminalInput);
      return { ok: true as const };
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
    expect(tracker.runStarted).toBeGreaterThanOrEqual(1);
    // The gate record carries the org and the research context the reviewer renders.
    expect(tracker.approvalRequests).toHaveLength(1);
    expect(tracker.approvalRequests[0]).toMatchObject({
      orgId: "org-1",
      approverId: input.approverId,
      context: { research: findings },
    });
    expect(tracker.terminal).toHaveLength(1);
    expect(tracker.terminal[0]).toMatchObject({
      orgId: "org-1",
      status: "completed",
    });
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

  it("records a failed run when research exhausts its retries", async () => {
    // 5 = the workflow's maximumAttempts for step activities — never succeeds.
    const { tracker, activities } = makeMocks({ researchFailuresBeforeSuccess: 99 });
    const taskQueue = "test-content-failure";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(contentPipeline, {
        taskQueue,
        workflowId: "content-failure",
        args: [input],
      });
      await expect(handle.result()).rejects.toThrow();
    });
    expect(tracker.researchAttempts).toBe(5);
    expect(tracker.writeCalls).toBe(0);
    expect(tracker.terminal).toHaveLength(1);
    expect(tracker.terminal[0]).toMatchObject({
      status: "failed",
      failedStep: "research",
    });
    expect(tracker.terminal[0]?.error).toContain("transient mock research failure");
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
    expect(tracker.terminal).toHaveLength(1);
    expect(tracker.terminal[0]).toMatchObject({ status: "rejected" });
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
    expect(tracker.terminal).toHaveLength(1);
    expect(tracker.terminal[0]).toMatchObject({ status: "expired" });
  });

  // Resume-from-step (Unit 22): call counts prove completed steps never
  // re-execute (the build plan's verification line — no re-spent tokens).

  it("resumes at write: skips research and the gate, writes with the carried findings", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-content-resume-write";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(contentPipeline, {
        taskQueue,
        workflowId: "content-resume-write",
        args: [
          {
            ...input,
            resumeFrom: { step: "write", priorOutputs: { research: findings } },
          },
        ],
      });
      // No signal sent — a resumed-past-the-gate run must complete on its own.
      const result = await handle.result();
      expect(result.status).toBe("completed");
    });
    expect(tracker.researchAttempts).toBe(0);
    expect(tracker.approvalRequests).toHaveLength(0);
    expect(tracker.writeCalls).toBe(1);
    expect(tracker.publishCalls).toBe(1);
    expect(tracker.writeInputs[0]).toMatchObject({ findings });
    expect(tracker.terminal[0]).toMatchObject({ status: "completed" });
  });

  it("resumes at publish: only publish executes, delivering the carried draft", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-content-resume-publish";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(contentPipeline, {
        taskQueue,
        workflowId: "content-resume-publish",
        args: [
          {
            ...input,
            resumeFrom: {
              step: "publish",
              priorOutputs: { research: findings, write: draft },
            },
          },
        ],
      });
      const result = await handle.result();
      expect(result.status).toBe("completed");
      if (result.status === "completed") {
        expect(result.output.draft).toEqual(draft);
      }
    });
    expect(tracker.researchAttempts).toBe(0);
    expect(tracker.approvalRequests).toHaveLength(0);
    expect(tracker.writeCalls).toBe(0);
    expect(tracker.publishCalls).toBe(1);
  });

  it("resumes at approval: skips research but re-runs the gate before writing", async () => {
    const { tracker, activities } = makeMocks();
    const taskQueue = "test-content-resume-approval";

    await runWorker(taskQueue, activities, async () => {
      const handle = await testEnv.client.workflow.start(contentPipeline, {
        taskQueue,
        workflowId: "content-resume-approval",
        args: [
          {
            ...input,
            resumeFrom: { step: "approval", priorOutputs: { research: findings } },
          },
        ],
      });
      await handle.signal(approvalDecisionSignal, approvedPayload);
      const result = await handle.result();
      expect(result.status).toBe("completed");
    });
    expect(tracker.researchAttempts).toBe(0);
    // A fresh gate is created for the new run, carrying the prior findings.
    expect(tracker.approvalRequests).toHaveLength(1);
    expect(tracker.approvalRequests[0]).toMatchObject({
      context: { research: findings },
    });
    expect(tracker.writeCalls).toBe(1);
    expect(tracker.publishCalls).toBe(1);
  });
});
