import { describe, expect, it } from "vitest";
import {
  modelIdSchema,
  modelOptionSchema,
  modelCatalogResponseSchema,
  orgModelSettingsSchema,
  orgModelSettingsResponseSchema,
} from "./models";

describe("modelIdSchema", () => {
  it("accepts provider/model slugs", () => {
    expect(modelIdSchema.parse("anthropic/claude-opus-4.8")).toBe(
      "anthropic/claude-opus-4.8",
    );
    expect(modelIdSchema.parse("google/gemma-4-31b-it:free")).toBe(
      "google/gemma-4-31b-it:free",
    );
  });

  it("rejects slugs without a provider segment", () => {
    expect(modelIdSchema.safeParse("claude-opus-4.8").success).toBe(false);
  });

  it("rejects uppercase providers and empty segments", () => {
    expect(modelIdSchema.safeParse("Anthropic/claude").success).toBe(false);
    expect(modelIdSchema.safeParse("anthropic/").success).toBe(false);
  });

  it("rejects over-long ids (boundary)", () => {
    expect(modelIdSchema.safeParse(`a/${"x".repeat(127)}`).success).toBe(false);
  });
});

describe("modelOptionSchema / modelCatalogResponseSchema", () => {
  const option = {
    id: "openai/gpt-5.5",
    name: "OpenAI: GPT-5.5",
    provider: "openai",
    free: false,
  };

  it("accepts a valid option and catalog", () => {
    expect(modelOptionSchema.parse(option)).toEqual(option);
    expect(modelCatalogResponseSchema.parse({ models: [option] }).models).toHaveLength(1);
  });

  it("rejects an option missing the free flag", () => {
    const rest = { id: option.id, name: option.name, provider: option.provider };
    expect(modelOptionSchema.safeParse(rest).success).toBe(false);
  });
});

describe("orgModelSettingsSchema", () => {
  it("accepts explicit nulls (platform default)", () => {
    expect(orgModelSettingsSchema.parse({ researchModel: null, writingModel: null })).toEqual(
      { researchModel: null, writingModel: null },
    );
  });

  it("accepts a mixed choice", () => {
    expect(
      orgModelSettingsSchema.parse({
        researchModel: "google/gemini-3.5-flash",
        writingModel: null,
      }).researchModel,
    ).toBe("google/gemini-3.5-flash");
  });

  it("rejects a missing field (full replace, no partial patch)", () => {
    expect(orgModelSettingsSchema.safeParse({ researchModel: null }).success).toBe(false);
  });

  it("rejects a malformed slug", () => {
    expect(
      orgModelSettingsSchema.safeParse({ researchModel: "not a slug", writingModel: null })
        .success,
    ).toBe(false);
  });
});

describe("orgModelSettingsResponseSchema", () => {
  it("accepts settings plus defaults", () => {
    const parsed = orgModelSettingsResponseSchema.parse({
      settings: { researchModel: null, writingModel: "anthropic/claude-opus-4.8" },
      defaults: {
        research: "anthropic/claude-sonnet-4.5",
        writing: "anthropic/claude-opus-4.8",
      },
    });
    expect(parsed.defaults.research).toBe("anthropic/claude-sonnet-4.5");
  });

  it("rejects missing defaults", () => {
    expect(
      orgModelSettingsResponseSchema.safeParse({
        settings: { researchModel: null, writingModel: null },
      }).success,
    ).toBe(false);
  });
});
