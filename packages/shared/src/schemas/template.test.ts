import { describe, expect, it } from "vitest";
import { z } from "zod";
import { graphSpecSchema } from "./graph-spec";
import {
  definitionParametersSchema,
  launchRunRequestSchema,
  templateCatalog,
  templateFieldSchema,
  templateKeySchema,
  templateListResponseSchema,
} from "./template";

const params = {
  topic: "Durable AI pipelines",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_1",
};

describe("templateCatalog", () => {
  const entries = Object.values(templateCatalog);

  it("every entry is internally consistent (key, name, valid spec)", () => {
    for (const entry of entries) {
      expect(templateKeySchema.safeParse(entry.key).success).toBe(true);
      // Customer-facing name IS the spec name — dashboard vocabulary.
      expect(entry.name).toBe(entry.spec.name);
      expect(graphSpecSchema.safeParse(entry.spec).success).toBe(true);
    }
  });

  it("fields mirror the parameter schema keys exactly (form ↔ contract)", () => {
    for (const entry of entries) {
      for (const field of entry.fields) {
        expect(templateFieldSchema.safeParse(field).success).toBe(true);
      }
      const schema = entry.paramsSchema;
      expect(schema instanceof z.ZodObject).toBe(true);
      const schemaKeys = Object.keys((schema as z.ZodObject).shape).sort();
      const fieldNames = entry.fields.map((f) => f.name).sort();
      expect(fieldNames).toEqual(schemaKeys);
    }
  });

  it("the blog entry validates its canonical params", () => {
    expect(
      templateCatalog["blog-post-pipeline"].paramsSchema.safeParse(params).success,
    ).toBe(true);
  });
});

describe("launchRunRequestSchema", () => {
  it("accepts a launch whose params match the template schema", () => {
    expect(
      launchRunRequestSchema.safeParse({ templateKey: "blog-post-pipeline", params })
        .success,
    ).toBe(true);
  });

  it("rejects params that violate the template schema (boundary)", () => {
    expect(
      launchRunRequestSchema.safeParse({
        templateKey: "blog-post-pipeline",
        params: { ...params, wordCount: 99 },
      }).success,
    ).toBe(false);
    expect(
      launchRunRequestSchema.safeParse({
        templateKey: "blog-post-pipeline",
        params: {},
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown template key", () => {
    expect(
      launchRunRequestSchema.safeParse({ templateKey: "nope", params }).success,
    ).toBe(false);
  });
});

describe("definitionParametersSchema", () => {
  it("round-trips the stored template link and rejects unknown keys", () => {
    expect(
      definitionParametersSchema.safeParse({ templateKey: "blog-post-pipeline" }).success,
    ).toBe(true);
    expect(definitionParametersSchema.safeParse({ templateKey: "x" }).success).toBe(false);
    expect(definitionParametersSchema.safeParse({}).success).toBe(false);
  });
});

describe("templateListResponseSchema", () => {
  it("accepts a pinned-template listing and rejects a malformed one", () => {
    const item = {
      key: "blog-post-pipeline",
      name: "Blog Post Pipeline",
      description: "d",
      definitionId: "3f1f7f9e-7b9b-4a4e-9a3e-2d6a1d9d2f10",
      version: 1,
    };
    expect(templateListResponseSchema.safeParse({ items: [item] }).success).toBe(true);
    expect(
      templateListResponseSchema.safeParse({ items: [{ ...item, version: 0 }] }).success,
    ).toBe(false);
  });
});
