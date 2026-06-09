import { describe, it, expect } from "vitest";
import {
  blogPostPipelineInputSchema,
  researchFindingsSchema,
  blogDraftSchema,
  blogPostPipelineOutputSchema,
} from "./blog-pipeline";

describe("blogPostPipelineInputSchema", () => {
  const valid = {
    topic: "How durable workflows prevent lost AI runs",
    keywords: ["durable execution", "temporal"],
    tone: "technical",
    wordCount: 1200,
    approverId: "user_42",
  };

  it("accepts a well-formed launch input", () => {
    expect(blogPostPipelineInputSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts the wordCount boundaries 100 and 5000", () => {
    expect(blogPostPipelineInputSchema.safeParse({ ...valid, wordCount: 100 }).success).toBe(true);
    expect(blogPostPipelineInputSchema.safeParse({ ...valid, wordCount: 5000 }).success).toBe(true);
  });

  it("rejects wordCount outside 100..5000 (boundary)", () => {
    expect(blogPostPipelineInputSchema.safeParse({ ...valid, wordCount: 99 }).success).toBe(false);
    expect(blogPostPipelineInputSchema.safeParse({ ...valid, wordCount: 5001 }).success).toBe(
      false,
    );
  });

  it("rejects a non-integer wordCount", () => {
    expect(blogPostPipelineInputSchema.safeParse({ ...valid, wordCount: 1200.5 }).success).toBe(
      false,
    );
  });

  it("rejects an empty keywords array and > 10 keywords (boundary)", () => {
    expect(blogPostPipelineInputSchema.safeParse({ ...valid, keywords: [] }).success).toBe(false);
    expect(
      blogPostPipelineInputSchema.safeParse({
        ...valid,
        keywords: Array.from({ length: 11 }, (_, i) => `k${i}`),
      }).success,
    ).toBe(false);
  });

  it("rejects an empty topic and a topic over 200 chars (boundary)", () => {
    expect(blogPostPipelineInputSchema.safeParse({ ...valid, topic: "" }).success).toBe(false);
    expect(
      blogPostPipelineInputSchema.safeParse({ ...valid, topic: "x".repeat(201) }).success,
    ).toBe(false);
  });

  it("rejects an unknown tone", () => {
    expect(blogPostPipelineInputSchema.safeParse({ ...valid, tone: "snarky" }).success).toBe(false);
  });

  it("rejects an orgId smuggled in the body being relied on (orgId is not part of the schema)", () => {
    const parsed = blogPostPipelineInputSchema.parse({ ...valid, orgId: "org_evil" });
    expect("orgId" in parsed).toBe(false);
  });
});

describe("researchFindingsSchema", () => {
  const valid = {
    summary: "Key findings about durable execution.",
    sources: [{ title: "Temporal docs", url: "https://docs.temporal.io", takeaway: "Replay-safe." }],
    keyPoints: ["Runs survive crashes"],
  };

  it("accepts well-formed findings", () => {
    expect(researchFindingsSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-URL source url", () => {
    expect(
      researchFindingsSchema.safeParse({
        ...valid,
        sources: [{ title: "x", url: "not a url", takeaway: "y" }],
      }).success,
    ).toBe(false);
  });

  it("rejects empty sources / keyPoints (boundary)", () => {
    expect(researchFindingsSchema.safeParse({ ...valid, sources: [] }).success).toBe(false);
    expect(researchFindingsSchema.safeParse({ ...valid, keyPoints: [] }).success).toBe(false);
  });
});

describe("blogDraftSchema", () => {
  it("accepts a draft and rejects a non-positive wordCount", () => {
    const valid = { title: "T", markdown: "# Body", wordCount: 1200 };
    expect(blogDraftSchema.safeParse(valid).success).toBe(true);
    expect(blogDraftSchema.safeParse({ ...valid, wordCount: 0 }).success).toBe(false);
  });
});

describe("blogPostPipelineOutputSchema", () => {
  const draft = { title: "T", markdown: "# Body", wordCount: 1200 };

  it("accepts output with and without publishedUrl", () => {
    expect(
      blogPostPipelineOutputSchema.safeParse({ draft, deliveredAt: "2026-06-10T12:00:00.000Z" })
        .success,
    ).toBe(true);
    expect(
      blogPostPipelineOutputSchema.safeParse({
        draft,
        publishedUrl: "https://example.com/post",
        deliveredAt: "2026-06-10T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid publishedUrl and a bad deliveredAt", () => {
    expect(
      blogPostPipelineOutputSchema.safeParse({
        draft,
        publishedUrl: "not a url",
        deliveredAt: "2026-06-10T12:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(blogPostPipelineOutputSchema.safeParse({ draft, deliveredAt: "nope" }).success).toBe(
      false,
    );
  });
});
