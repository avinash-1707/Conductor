import { describe, expect, it } from "vitest";
import type { Step } from "@conductor/db";
import { buildResumePlan } from "./resume-plan";

/**
 * Pure derivation tests for the resume plan (Unit 22) — no Postgres. The
 * route suite covers the same logic end-to-end; these pin the fallback chain,
 * including corrupt stored outputs.
 */

const findings = {
  summary: "Prior research summary.",
  sources: [
    { title: "Source", url: "https://example.com/a", takeaway: "Takeaway." },
  ],
  keyPoints: ["Key point"],
};

const draft = { title: "Draft", markdown: "# Draft", wordCount: 900 };

function makeStep(args: {
  stepKind: Step["stepKind"];
  status: Step["status"];
  output?: unknown;
}): Step {
  return {
    id: "1c8e7a1e-1111-4222-8333-444455556666",
    orgId: "org_1",
    runId: "0c8e7a1e-1111-4222-8333-444455556666",
    stepKind: args.stepKind,
    status: args.status,
    attempt: 2,
    input: null,
    output: args.output ?? null,
    error: null,
    startedAt: new Date("2026-06-10T12:00:00.000Z"),
    completedAt: new Date("2026-06-10T12:01:00.000Z"),
    createdAt: new Date("2026-06-10T12:00:00.000Z"),
    updatedAt: new Date("2026-06-10T12:01:00.000Z"),
  };
}

describe("buildResumePlan", () => {
  it("resumes at publish when research and write both completed", () => {
    const research = makeStep({ stepKind: "research", status: "completed", output: findings });
    const write = makeStep({ stepKind: "write", status: "completed", output: draft });
    const failed = makeStep({ stepKind: "publish", status: "failed" });

    const plan = buildResumePlan([research, write, failed], true);
    expect(plan.resumeFrom).toEqual({
      step: "publish",
      priorOutputs: { research: findings, write: draft },
    });
    expect(plan.carriedSteps).toEqual([research, write]);
  });

  it("resumes at write when research completed and the gate was approved", () => {
    const research = makeStep({ stepKind: "research", status: "completed", output: findings });
    const failed = makeStep({ stepKind: "write", status: "failed" });

    const plan = buildResumePlan([research, failed], true);
    expect(plan.resumeFrom).toEqual({
      step: "write",
      priorOutputs: { research: findings },
    });
    expect(plan.carriedSteps).toEqual([research]);
  });

  it("re-runs the gate when research completed but it was never approved", () => {
    const research = makeStep({ stepKind: "research", status: "completed", output: findings });

    const plan = buildResumePlan([research], false);
    expect(plan.resumeFrom).toEqual({
      step: "approval",
      priorOutputs: { research: findings },
    });
  });

  it("restarts fully when nothing completed", () => {
    const failed = makeStep({ stepKind: "research", status: "failed" });
    expect(buildResumePlan([failed], false)).toEqual({
      resumeFrom: undefined,
      carriedSteps: [],
    });
  });

  it("treats a corrupt stored research output as not completed", () => {
    const corrupt = makeStep({
      stepKind: "research",
      status: "completed",
      output: { summary: "" },
    });
    expect(buildResumePlan([corrupt], true)).toEqual({
      resumeFrom: undefined,
      carriedSteps: [],
    });
  });

  it("falls back to write when the stored write output is corrupt", () => {
    const research = makeStep({ stepKind: "research", status: "completed", output: findings });
    const corruptWrite = makeStep({
      stepKind: "write",
      status: "completed",
      output: { title: "no markdown" },
    });

    const plan = buildResumePlan([research, corruptWrite], true);
    expect(plan.resumeFrom).toEqual({
      step: "write",
      priorOutputs: { research: findings },
    });
    expect(plan.carriedSteps).toEqual([research]);
  });
});
