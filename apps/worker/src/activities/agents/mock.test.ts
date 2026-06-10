import { describe, expect, it, vi } from "vitest";
import { blogDraftSchema, researchFindingsSchema } from "@conductor/shared";
import { createMockResearchLLM, createMockWritingLLM } from "./mock";
import { runResearch } from "./research";
import { runWriting } from "./writing";

/**
 * The LLM_MODE=mock model layer (Unit 23) must satisfy the same contracts as
 * the OpenRouter-backed one: the real graphs run over it, outputs parse the
 * shared schemas, and the streamed fields reach `onDelta`. `delayMs: 0` keeps
 * the suite fast — pacing is for the live dashboard only.
 */

const input = {
  topic: "Durable AI pipelines",
  keywords: ["temporal", "reliability"],
  tone: "technical" as const,
};

describe("mock LLMs", () => {
  it("drives the research graph to schema-valid findings and streams the summary", async () => {
    const onDelta = vi.fn();
    const findings = await runResearch(
      input,
      createMockResearchLLM({ onDelta, delayMs: 0 }),
    );

    expect(researchFindingsSchema.safeParse(findings).success).toBe(true);
    expect(findings.summary).toContain("Durable AI pipelines");
    // The streamed deltas concatenate to exactly the returned summary.
    const streamed = onDelta.mock.calls.map((c) => c[0] as string).join("");
    expect(streamed).toBe(findings.summary);
  });

  it("drives the writing graph to a schema-valid draft and streams the markdown", async () => {
    const findings = await runResearch(input, createMockResearchLLM({ delayMs: 0 }));
    const onDelta = vi.fn();
    const draft = await runWriting(
      { ...input, wordCount: 300, findings },
      createMockWritingLLM({ onDelta, delayMs: 0 }),
    );

    expect(blogDraftSchema.safeParse(draft).success).toBe(true);
    const streamed = onDelta.mock.calls.map((c) => c[0] as string).join("");
    expect(streamed).toBe(draft.markdown);
    // wordCount is computed by the graph's finalize, never trusted from a model.
    expect(draft.wordCount).toBeGreaterThan(0);
  });

  it("is deterministic for the same input (idempotent activities, invariant 2)", async () => {
    const a = await runResearch(input, createMockResearchLLM({ delayMs: 0 }));
    const b = await runResearch(input, createMockResearchLLM({ delayMs: 0 }));
    expect(a).toEqual(b);
  });
});
