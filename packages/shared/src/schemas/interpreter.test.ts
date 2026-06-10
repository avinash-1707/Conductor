import { describe, expect, it } from "vitest";
import { blogPostPipelineSpec } from "./graph-spec";
import { interpreterInputSchema, interpreterResultSchema } from "./interpreter";

const params = {
  topic: "Durable AI pipelines",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_1",
};

const valid = {
  orgId: "org_1",
  spec: blogPostPipelineSpec,
  params,
};

describe("interpreterInputSchema", () => {
  it("accepts an org + validated spec + launch params", () => {
    expect(interpreterInputSchema.safeParse(valid).success).toBe(true);
  });

  it("re-runs the full graph validation on the inline spec", () => {
    const broken = {
      ...valid,
      spec: {
        ...blogPostPipelineSpec,
        // Orphans write/publish: two start nodes → structural rejection.
        edges: blogPostPipelineSpec.edges.slice(0, 1),
      },
    };
    expect(interpreterInputSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a missing orgId and bad params (boundary)", () => {
    expect(interpreterInputSchema.safeParse({ ...valid, orgId: "" }).success).toBe(false);
    expect(
      interpreterInputSchema.safeParse({
        ...valid,
        params: { ...params, wordCount: 99 },
      }).success,
    ).toBe(false);
  });
});

describe("interpreterResultSchema", () => {
  it("accepts the three terminal variants", () => {
    expect(
      interpreterResultSchema.safeParse({
        status: "completed",
        output: {
          draft: { title: "T", markdown: "# T", wordCount: 1200 },
          deliveredAt: "2026-06-10T12:00:00.000Z",
        },
      }).success,
    ).toBe(true);
    // Completed without output: a valid chain that produced no deliverable.
    expect(interpreterResultSchema.safeParse({ status: "completed" }).success).toBe(true);
    expect(
      interpreterResultSchema.safeParse({
        status: "rejected",
        reviewerId: "user_1",
        decidedAt: "2026-06-10T12:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(interpreterResultSchema.safeParse({ status: "expired" }).success).toBe(true);
  });

  it("rejects unknown statuses and malformed variants", () => {
    expect(interpreterResultSchema.safeParse({ status: "running" }).success).toBe(false);
    expect(interpreterResultSchema.safeParse({ status: "rejected" }).success).toBe(false);
  });
});
