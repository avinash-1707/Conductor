import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockActivityEnvironment } from "@temporalio/testing";
import { ApplicationFailure } from "@temporalio/activity";
import { z } from "zod";
import type { Run } from "@conductor/db";

// The worker db module is the single seam: mocking it keeps these tests
// network-free (code-standards Testing — activities as plain functions with
// mocked dependencies).
vi.mock("../db", () => ({
  repos: {
    runs: {
      findRunByTemporalId: vi.fn(),
      markRunStatus: vi.fn(),
    },
    activityLog: {
      startStepAttempt: vi.fn(),
      recordLlmObservation: vi.fn(),
      completeStep: vi.fn(),
      failStepAttempt: vi.fn(),
    },
  },
}));

// The realtime publisher is best-effort and network-bound; mock it so the
// tests assert the token-stream side channel (Unit 20) without Redis.
vi.mock("../realtime/publisher", () => ({
  publishRunEvent: vi.fn(),
  publishTokenEvent: vi.fn(),
}));

import { repos } from "../db";
import { publishTokenEvent } from "../realtime/publisher";
import { withStepTracking } from "./with-step-tracking";

const RUN: Run = {
  id: "0c8e7a1e-1111-4222-8333-444455556666",
  orgId: "org-1",
  definitionId: null,
  workflowName: "contentPipeline",
  temporalWorkflowId: "wf-1",
  temporalRunId: "tr-1",
  resumedFromRunId: null,
  status: "running",
  input: {
    topic: "t",
    keywords: ["k"],
    tone: "technical",
    wordCount: 800,
    approverId: "u",
  },
  output: null,
  error: null,
  startedAt: new Date(),
  completedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const inputSchema = z.object({ orgId: z.string().min(1), value: z.number() });
const input = { orgId: "org-1", value: 7 };

function activityEnv(attempt = 1): MockActivityEnvironment {
  return new MockActivityEnvironment({
    attempt,
    workflowExecution: { workflowId: "wf-1", runId: "tr-1" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repos.runs.findRunByTemporalId).mockResolvedValue(RUN);
  vi.mocked(repos.runs.markRunStatus).mockResolvedValue(RUN);
  vi.mocked(repos.activityLog.startStepAttempt).mockResolvedValue(
    {} as Awaited<ReturnType<typeof repos.activityLog.startStepAttempt>>,
  );
  vi.mocked(repos.activityLog.recordLlmObservation).mockResolvedValue(undefined);
  vi.mocked(repos.activityLog.completeStep).mockResolvedValue(undefined);
  vi.mocked(repos.activityLog.failStepAttempt).mockResolvedValue(undefined);
});

describe("withStepTracking", () => {
  it("records start, run status, and completion around a successful step", async () => {
    const tracked = withStepTracking("research", inputSchema, async (i) => i.value * 2);
    const result = await activityEnv(1).run(tracked, input);

    expect(result).toBe(14);
    expect(repos.activityLog.startStepAttempt).toHaveBeenCalledWith({
      orgId: "org-1",
      runId: RUN.id,
      stepKind: "research",
      attempt: 1,
      input,
    });
    expect(repos.runs.markRunStatus).toHaveBeenCalledWith({
      orgId: "org-1",
      temporalWorkflowId: "wf-1",
      status: "running",
    });
    expect(repos.activityLog.completeStep).toHaveBeenCalledWith({
      orgId: "org-1",
      runId: RUN.id,
      stepKind: "research",
      output: 14,
    });
    expect(repos.activityLog.failStepAttempt).not.toHaveBeenCalled();
  });

  it("records `retrying` for a retryable failure and rethrows", async () => {
    const tracked = withStepTracking("write", inputSchema, async () => {
      throw new Error("transient upstream failure");
    });

    await expect(activityEnv(2).run(tracked, input)).rejects.toThrow(
      "transient upstream failure",
    );
    expect(repos.activityLog.startStepAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2 }),
    );
    expect(repos.activityLog.failStepAttempt).toHaveBeenCalledWith({
      orgId: "org-1",
      runId: RUN.id,
      stepKind: "write",
      error: "transient upstream failure",
      terminal: false,
    });
    expect(repos.activityLog.completeStep).not.toHaveBeenCalled();
  });

  it("records `failed` for a non-retryable failure", async () => {
    const tracked = withStepTracking("write", inputSchema, async () => {
      throw ApplicationFailure.nonRetryable("bad config", "MissingOrgApiKey");
    });

    await expect(activityEnv(1).run(tracked, input)).rejects.toMatchObject({
      type: "MissingOrgApiKey",
    });
    expect(repos.activityLog.failStepAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: true }),
    );
  });

  it("rejects invalid input non-retryably before any projection write", async () => {
    const tracked = withStepTracking("research", inputSchema, async (i) => i.value);

    await expect(
      activityEnv(1).run(tracked, { orgId: "", value: 1 }),
    ).rejects.toMatchObject({ type: "InvalidActivityInput", nonRetryable: true });
    expect(repos.runs.findRunByTemporalId).not.toHaveBeenCalled();
    expect(repos.activityLog.startStepAttempt).not.toHaveBeenCalled();
  });

  it("throws retryably when the run projection row is missing", async () => {
    vi.mocked(repos.runs.findRunByTemporalId).mockResolvedValue(undefined);
    const tracked = withStepTracking("research", inputSchema, async (i) => i.value);

    await expect(activityEnv(1).run(tracked, input)).rejects.toThrow(
      /projection row missing/,
    );
    expect(repos.activityLog.startStepAttempt).not.toHaveBeenCalled();
  });

  it("never fails a finished step because the completion projection write failed", async () => {
    vi.mocked(repos.activityLog.completeStep).mockRejectedValue(new Error("db down"));
    const tracked = withStepTracking("publish", inputSchema, async (i) => i.value);

    await expect(activityEnv(1).run(tracked, input)).resolves.toBe(7);
  });

  it("propagates the original error when the failure projection write also fails", async () => {
    vi.mocked(repos.activityLog.failStepAttempt).mockRejectedValue(
      new Error("db down"),
    );
    const tracked = withStepTracking("publish", inputSchema, async () => {
      throw new Error("the real failure");
    });

    await expect(activityEnv(1).run(tracked, input)).rejects.toThrow("the real failure");
  });

  it("streams tokens through ctx.emitToken and closes the stream with done", async () => {
    const tracked = withStepTracking("research", inputSchema, async (i, ctx) => {
      ctx.emitToken("Hel");
      ctx.emitToken("lo");
      return i.value;
    });

    await activityEnv(1).run(tracked, input);

    expect(publishTokenEvent).toHaveBeenCalledWith({
      type: "token",
      runId: RUN.id,
      step: "research",
      delta: "Hel",
    });
    expect(publishTokenEvent).toHaveBeenCalledWith({
      type: "token",
      runId: RUN.id,
      step: "research",
      delta: "lo",
    });
    // The done marker closes the live tail after the step finishes.
    expect(publishTokenEvent).toHaveBeenCalledWith({
      type: "done",
      runId: RUN.id,
      step: "research",
    });
  });

  it("persists LLM observations best-effort outside the activity output", async () => {
    const tracked = withStepTracking("research", inputSchema, async (i, ctx) => {
      await ctx.recordLlmObservation({
        operation: "research.gather",
        model: "provider/model",
        tier: "fast",
        promptVersion: "research.gather@v1",
        latencyMs: 12,
        inputTokens: 4,
        outputTokens: 2,
        totalTokens: 6,
        costUsd: 0.001,
        repaired: false,
      });
      return i.value;
    });

    await expect(activityEnv(1).run(tracked, input)).resolves.toBe(7);
    expect(repos.activityLog.recordLlmObservation).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        runId: RUN.id,
        stepKind: "research",
        observation: expect.objectContaining({ operation: "research.gather" }),
      }),
    );
    expect(repos.activityLog.completeStep).toHaveBeenCalledWith(
      expect.objectContaining({ output: 7 }),
    );
  });

  it("still emits a stream `done` when the step fails", async () => {
    const tracked = withStepTracking("write", inputSchema, async () => {
      throw new Error("boom");
    });

    await expect(activityEnv(1).run(tracked, input)).rejects.toThrow("boom");
    expect(publishTokenEvent).toHaveBeenCalledWith({
      type: "done",
      runId: RUN.id,
      step: "write",
    });
  });
});
