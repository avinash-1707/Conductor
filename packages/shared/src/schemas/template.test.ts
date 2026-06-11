import { describe, expect, it } from "vitest";
import { z } from "zod";
import { graphSpecSchema } from "./graph-spec";
import {
  definitionParametersSchema,
  engineParamsSchema,
  launchRunRequestSchema,
  templateCatalog,
  templateFieldSchema,
  templateKeySchema,
  templateListResponseSchema,
  type TemplateKey,
} from "./template";

const params = {
  topic: "Durable AI pipelines",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 1200,
  approverId: "user_1",
};

/** Canonical valid params per template — every catalog-wide test loops these. */
const canonicalParams: Record<TemplateKey, Record<string, unknown>> = {
  "blog-post-pipeline": params,
  "seo-brief": {
    targetKeyword: "ai workflow automation",
    secondaryKeywords: ["durable ai pipelines"],
    audience: "Heads of content at B2B agencies",
    approverId: "user_1",
  },
  "competitor-research": {
    company: "Conductor",
    competitors: ["Zapier", "n8n"],
    focusAreas: [],
    approverId: "user_1",
  },
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

  it("every entry validates its canonical params", () => {
    for (const entry of entries) {
      expect(
        entry.paramsSchema.safeParse(canonicalParams[entry.key]).success,
        entry.key,
      ).toBe(true);
    }
  });

  it("every entry maps canonical params onto a valid engine contract (Unit 29)", () => {
    for (const entry of entries) {
      const engine = entry.toEngineParams(canonicalParams[entry.key]);
      expect(engineParamsSchema.safeParse(engine).success, entry.key).toBe(true);
      // The approver always survives the mapping — the gate depends on it.
      expect(engine.approverId).toBe("user_1");
      expect(engine.keywords.length).toBeGreaterThan(0);
    }
  });

  it("the blog mapping is the identity", () => {
    expect(templateCatalog["blog-post-pipeline"].toEngineParams(params)).toEqual(params);
  });

  it("seo-brief maps keyword + audience into the engine topic and keyword list", () => {
    const engine = templateCatalog["seo-brief"].toEngineParams(
      canonicalParams["seo-brief"],
    );
    expect(engine.topic).toContain('"ai workflow automation"');
    expect(engine.topic).toContain("Heads of content at B2B agencies");
    expect(engine.keywords).toEqual(["ai workflow automation", "durable ai pipelines"]);
    expect(engine.tone).toBe("professional");
  });

  it("competitor-research defaults empty focus areas and carries competitors", () => {
    const engine = templateCatalog["competitor-research"].toEngineParams(
      canonicalParams["competitor-research"],
    );
    expect(engine.topic).toContain("Zapier, n8n");
    expect(engine.topic).toContain("positioning, pricing, messaging");
    expect(engine.keywords).toEqual(["Conductor", "Zapier", "n8n"]);
  });

  it("optional csv params may be omitted entirely (schema defaults apply)", () => {
    const withoutSecondary = { ...canonicalParams["seo-brief"] };
    delete withoutSecondary.secondaryKeywords;
    expect(
      templateCatalog["seo-brief"].paramsSchema.safeParse(withoutSecondary).success,
    ).toBe(true);
    const engine = templateCatalog["seo-brief"].toEngineParams(withoutSecondary);
    expect(engine.keywords).toEqual(["ai workflow automation"]);
  });

  it("toEngineParams rejects params that violate the template schema", () => {
    expect(() => templateCatalog["seo-brief"].toEngineParams({})).toThrow();
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
