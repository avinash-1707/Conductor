import { describe, expect, it } from "vitest";
import { contentPipelineInputSchema, resumeFromSchema } from "./workflow-inputs";

const valid = {
  orgId: "org_1",
  topic: "Durable AI pipelines",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_1",
};

const research = {
  summary: "Prior research summary.",
  sources: [
    { title: "Source", url: "https://example.com/a", takeaway: "Takeaway." },
  ],
  keyPoints: ["Key point"],
};

const write = { title: "Draft", markdown: "# Draft", wordCount: 1200 };

describe("contentPipelineInputSchema", () => {
  it("accepts a complete workflow input", () => {
    expect(contentPipelineInputSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a missing orgId", () => {
    const rest = { ...valid, orgId: undefined };
    expect(contentPipelineInputSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty orgId", () => {
    expect(contentPipelineInputSchema.safeParse({ ...valid, orgId: "" }).success).toBe(
      false,
    );
  });

  it("still enforces the launch-parameter rules (boundary)", () => {
    expect(
      contentPipelineInputSchema.safeParse({ ...valid, wordCount: 99 }).success,
    ).toBe(false);
    expect(
      contentPipelineInputSchema.safeParse({ ...valid, keywords: [] }).success,
    ).toBe(false);
    expect(
      contentPipelineInputSchema.safeParse({ ...valid, wordCount: 100 }).success,
    ).toBe(true);
  });

  it("accepts an input carrying a resumeFrom block", () => {
    const input = {
      ...valid,
      resumeFrom: { step: "write", priorOutputs: { research } },
    };
    expect(contentPipelineInputSchema.parse(input)).toEqual(input);
  });
});

describe("resumeFromSchema", () => {
  it("accepts the approval and write variants with research only", () => {
    for (const step of ["approval", "write"] as const) {
      expect(
        resumeFromSchema.safeParse({ step, priorOutputs: { research } }).success,
      ).toBe(true);
    }
  });

  it("accepts the publish variant with research and write outputs", () => {
    expect(
      resumeFromSchema.safeParse({
        step: "publish",
        priorOutputs: { research, write },
      }).success,
    ).toBe(true);
  });

  it("rejects a publish resume missing the write output", () => {
    expect(
      resumeFromSchema.safeParse({ step: "publish", priorOutputs: { research } })
        .success,
    ).toBe(false);
  });

  it("rejects an unknown step and a missing research output", () => {
    expect(
      resumeFromSchema.safeParse({ step: "research", priorOutputs: { research } })
        .success,
    ).toBe(false);
    expect(
      resumeFromSchema.safeParse({ step: "write", priorOutputs: {} }).success,
    ).toBe(false);
  });
});
