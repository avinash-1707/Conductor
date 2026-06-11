import { describe, expect, it } from "vitest";
import { blogPostPipelineSpec } from "./graph-spec";
import {
  interpreterInputSchema,
  interpreterResultSchema,
  interpreterResumeSchema,
} from "./interpreter";

const params = {
  topic: "Durable AI pipelines",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_1",
};

const research = {
  summary: "Findings",
  sources: [{ title: "S", url: "https://example.com", takeaway: "T" }],
  keyPoints: ["K"],
};

const draft = { title: "T", markdown: "# T", wordCount: 1200 };

const valid = {
  orgId: "org_1",
  templateKey: "blog-post-pipeline",
  spec: blogPostPipelineSpec,
  params,
};

describe("interpreterInputSchema", () => {
  it("accepts an org + template key + validated spec + launch params", () => {
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

  it("validates params against the template's own schema (Unit 26)", () => {
    expect(
      interpreterInputSchema.safeParse({
        ...valid,
        params: { ...params, wordCount: 99 },
      }).success,
    ).toBe(false);
    expect(
      interpreterInputSchema.safeParse({ ...valid, params: {} }).success,
    ).toBe(false);
  });

  it("rejects an unknown template key and a missing orgId (boundary)", () => {
    expect(
      interpreterInputSchema.safeParse({ ...valid, templateKey: "nope" }).success,
    ).toBe(false);
    expect(interpreterInputSchema.safeParse({ ...valid, orgId: "" }).success).toBe(false);
  });

  it("accepts each resume variant", () => {
    for (const resumeFrom of [
      { channels: { research }, gateApproved: false },
      { channels: { research }, gateApproved: true },
      { channels: { research, draft }, gateApproved: true },
    ]) {
      expect(interpreterInputSchema.safeParse({ ...valid, resumeFrom }).success).toBe(true);
    }
  });
});

describe("interpreterResumeSchema", () => {
  it("rejects malformed channel payloads and a missing gate flag", () => {
    expect(
      interpreterResumeSchema.safeParse({
        channels: { research: { summary: "" } },
        gateApproved: true,
      }).success,
    ).toBe(false);
    expect(interpreterResumeSchema.safeParse({ channels: {} }).success).toBe(false);
  });

  it("accepts empty channels (defensive — the server omits resumeFrom instead)", () => {
    expect(
      interpreterResumeSchema.safeParse({ channels: {}, gateApproved: false }).success,
    ).toBe(true);
  });
});

describe("interpreterResultSchema", () => {
  it("accepts the three terminal variants", () => {
    expect(
      interpreterResultSchema.safeParse({
        status: "completed",
        output: {
          draft,
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
