import { describe, expect, it } from "vitest";
import { blogPostPipelineSpec } from "./graph-spec";
import { definitionResourceSchema } from "./definition";

const validDefinition = {
  id: "5c8e7a1e-1111-4222-8333-444455556666",
  name: "Blog Post Pipeline",
  description: null,
  version: 1,
  graphSpec: blogPostPipelineSpec,
  templateKey: "blog-post-pipeline",
  createdAt: "2026-06-10T12:00:00.000Z",
};

describe("definitionResourceSchema", () => {
  it("accepts a pinned template definition row", () => {
    expect(definitionResourceSchema.parse(validDefinition)).toEqual(validDefinition);
  });

  it("accepts legacy rows (null spec) and canvas-authored rows (null templateKey)", () => {
    expect(
      definitionResourceSchema.safeParse({ ...validDefinition, graphSpec: null })
        .success,
    ).toBe(true);
    expect(
      definitionResourceSchema.safeParse({ ...validDefinition, templateKey: null })
        .success,
    ).toBe(true);
  });

  it("rejects an invalid graph spec and an unknown template key (boundary)", () => {
    expect(
      definitionResourceSchema.safeParse({
        ...validDefinition,
        graphSpec: { ...blogPostPipelineSpec, edges: [] },
      }).success,
    ).toBe(false);
    expect(
      definitionResourceSchema.safeParse({
        ...validDefinition,
        templateKey: "not-a-template",
      }).success,
    ).toBe(false);
    expect(
      definitionResourceSchema.safeParse({ ...validDefinition, version: 0 }).success,
    ).toBe(false);
  });
});
