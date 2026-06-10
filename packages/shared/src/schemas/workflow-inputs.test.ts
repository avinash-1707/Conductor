import { describe, expect, it } from "vitest";
import { contentPipelineInputSchema } from "./workflow-inputs";

const valid = {
  orgId: "org_1",
  topic: "Durable AI pipelines",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_1",
};

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
});
