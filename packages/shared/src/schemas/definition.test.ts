import { describe, expect, it } from "vitest";
import { GRAPH_SPEC_VERSION, blogPostPipelineSpec, graphSpecSchema } from "./graph-spec";
import {
  definitionResourceSchema,
  launchDefinitionRunSchema,
  saveDefinitionRequestSchema,
} from "./definition";

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

const drawnSpec = graphSpecSchema.parse({
  specVersion: GRAPH_SPEC_VERSION,
  name: "Research Digest",
  nodes: [
    { id: "research", type: "research" },
    { id: "approval", type: "approval" },
    { id: "write", type: "write" },
  ],
  edges: [
    { from: "research", to: "approval" },
    { from: "approval", to: "write" },
  ],
});

describe("saveDefinitionRequestSchema (Unit 32)", () => {
  it("accepts a drawn spec with an optional description", () => {
    expect(saveDefinitionRequestSchema.safeParse({ graphSpec: drawnSpec }).success).toBe(true);
    expect(
      saveDefinitionRequestSchema.safeParse({
        graphSpec: drawnSpec,
        description: "Weekly digest pipeline",
      }).success,
    ).toBe(true);
  });

  it("rejects reserved template names case-insensitively", () => {
    for (const name of ["Blog Post Pipeline", "bLoG pOsT pIpElInE", "SEO Brief"]) {
      const result = saveDefinitionRequestSchema.safeParse({
        graphSpec: { ...drawnSpec, name },
      });
      expect(result.success, name).toBe(false);
      expect(result.error?.issues[0]?.message).toContain("built-in template name");
    }
  });

  it("rejects an invalid graph (the shared validator runs at the save door)", () => {
    expect(
      saveDefinitionRequestSchema.safeParse({
        graphSpec: { ...drawnSpec, edges: [] },
      }).success,
    ).toBe(false);
  });
});

describe("launchDefinitionRunSchema (Unit 32)", () => {
  const params = {
    topic: "Durable AI pipelines",
    keywords: ["temporal"],
    tone: "technical",
    wordCount: 1200,
    approverId: "user_1",
  };

  it("accepts engine-shaped params and rejects out-of-contract values", () => {
    expect(launchDefinitionRunSchema.safeParse({ params }).success).toBe(true);
    expect(
      launchDefinitionRunSchema.safeParse({ params: { ...params, wordCount: 9 } }).success,
    ).toBe(false);
    expect(launchDefinitionRunSchema.safeParse({}).success).toBe(false);
  });
});
