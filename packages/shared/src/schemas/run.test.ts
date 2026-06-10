import { describe, expect, it } from "vitest";
import {
  runSchema,
  runStepSchema,
  runListResponseSchema,
  runDetailResponseSchema,
} from "./run";

const validRun = {
  id: "0c8e7a1e-1111-4222-8333-444455556666",
  workflowName: "contentPipeline",
  temporalWorkflowId: "run-0c8e7a1e-1111-4222-8333-444455556666",
  temporalRunId: null,
  status: "pending",
  input: {
    topic: "Durable AI pipelines",
    keywords: ["temporal"],
    tone: "technical",
    wordCount: 1200,
    approverId: "user_1",
  },
  output: null,
  error: null,
  resumedFromRunId: null,
  startedAt: null,
  completedAt: null,
  createdAt: "2026-06-10T12:00:00.000Z",
};

const validStep = {
  id: "1c8e7a1e-1111-4222-8333-444455556666",
  stepKind: "research",
  status: "completed",
  attempt: 2,
  input: { topic: "t" },
  output: { summary: "s" },
  error: null,
  startedAt: "2026-06-10T12:00:01.000Z",
  completedAt: "2026-06-10T12:00:05.000Z",
};

describe("runSchema", () => {
  it("accepts a pending run resource", () => {
    expect(runSchema.parse(validRun)).toEqual(validRun);
  });

  it("accepts a resumed run linking its prior run, and rejects a non-uuid link", () => {
    const link = "2c8e7a1e-1111-4222-8333-444455556666";
    expect(
      runSchema.safeParse({ ...validRun, resumedFromRunId: link }).success,
    ).toBe(true);
    expect(
      runSchema.safeParse({ ...validRun, resumedFromRunId: "run-1" }).success,
    ).toBe(false);
  });

  it("accepts a completed run with output and timestamps", () => {
    const completed = {
      ...validRun,
      status: "completed",
      temporalRunId: "tr-1",
      output: {
        draft: { title: "T", markdown: "# T", wordCount: 900 },
        deliveredAt: "2026-06-10T12:05:00.000Z",
      },
      startedAt: "2026-06-10T12:00:01.000Z",
      completedAt: "2026-06-10T12:05:00.000Z",
    };
    expect(runSchema.safeParse(completed).success).toBe(true);
  });

  it("rejects an unknown status and a non-ISO timestamp (boundary)", () => {
    expect(runSchema.safeParse({ ...validRun, status: "paused" }).success).toBe(false);
    expect(runSchema.safeParse({ ...validRun, createdAt: "yesterday" }).success).toBe(
      false,
    );
  });

  it("rejects an org id sneaking into the resource shape", () => {
    // org_id is never part of the API contract — strict object would be wrong
    // for forward-compat, but the schema must not REQUIRE or expose it.
    expect("orgId" in runSchema.shape).toBe(false);
  });
});

describe("runStepSchema", () => {
  it("accepts a step row", () => {
    expect(runStepSchema.parse(validStep)).toEqual(validStep);
  });

  it("rejects a zero attempt and an unknown step kind", () => {
    expect(runStepSchema.safeParse({ ...validStep, attempt: 0 }).success).toBe(false);
    expect(
      runStepSchema.safeParse({ ...validStep, stepKind: "approval" }).success,
    ).toBe(false);
  });
});

describe("response envelopes", () => {
  it("accepts a page with a cursor and a terminal page with null", () => {
    expect(
      runListResponseSchema.safeParse({ items: [validRun], nextCursor: "abc" }).success,
    ).toBe(true);
    expect(
      runListResponseSchema.safeParse({ items: [], nextCursor: null }).success,
    ).toBe(true);
    expect(
      runListResponseSchema.safeParse({ items: [validRun], nextCursor: "" }).success,
    ).toBe(false);
  });

  it("accepts a run detail with steps", () => {
    expect(
      runDetailResponseSchema.safeParse({ run: validRun, steps: [validStep] }).success,
    ).toBe(true);
  });
});
