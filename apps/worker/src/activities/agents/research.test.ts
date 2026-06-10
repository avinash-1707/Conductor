import { describe, expect, it, vi } from "vitest";
import { researchFindingsSchema } from "@conductor/shared";
import {
  buildResearchGraph,
  runResearch,
  type ResearchLLM,
  type ResearchInput,
} from "./research";

const INPUT: ResearchInput = {
  topic: "Durable AI workflows",
  keywords: ["temporal", "reliability"],
  tone: "technical",
};

/** Deterministic fake — no network. */
function fakeLLM(overrides: Partial<ResearchLLM> = {}): ResearchLLM {
  return {
    gatherSources: vi.fn(async () => ({
      sources: [
        {
          title: "Temporal docs",
          url: "https://docs.temporal.io/",
          takeaway: "Workflows survive worker crashes.",
        },
        {
          title: "Reliability patterns",
          url: "https://example.com/reliability",
          takeaway: "Retries plus idempotency prevent lost work.",
        },
      ],
      notes: "Durability comes from event-sourced history, not the worker.",
    })),
    synthesize: vi.fn(async () => ({
      summary: "Durable execution keeps AI pipelines running across failures.",
      keyPoints: [
        "Temporal replays workflow history to recover state.",
        "Activities must be idempotent because they retry.",
      ],
    })),
    ...overrides,
  };
}

describe("research graph", () => {
  it("produces schema-valid findings through gather → synthesize → validate", async () => {
    const llm = fakeLLM();
    const findings = await runResearch(INPUT, llm);

    expect(() => researchFindingsSchema.parse(findings)).not.toThrow();
    expect(findings.sources).toHaveLength(2);
    expect(findings.keyPoints.length).toBeGreaterThan(0);
    expect(llm.gatherSources).toHaveBeenCalledTimes(1);
    expect(llm.synthesize).toHaveBeenCalledTimes(1);
  });

  it("threads gathered sources into the synthesize step", async () => {
    const synthesize = vi.fn(async () => ({
      summary: "ok",
      keyPoints: ["point"],
    }));
    const llm = fakeLLM({ synthesize });
    await runResearch(INPUT, llm);

    expect(synthesize).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: INPUT.topic,
        sources: expect.arrayContaining([
          expect.objectContaining({ title: "Temporal docs" }),
        ]),
      }),
    );
  });

  it("fails at the validate node when the model returns an unusable shape", async () => {
    const llm = fakeLLM({
      gatherSources: vi.fn(async () => ({ sources: [], notes: "" })),
    });
    // Empty sources violate researchFindingsSchema (min 1) — validate parses and throws.
    await expect(runResearch(INPUT, llm)).rejects.toThrow();
  });

  it("compiles to a runnable graph", () => {
    expect(() => buildResearchGraph(fakeLLM())).not.toThrow();
  });
});

// Activity-level failure branches (invalid input, missing/undecryptable org
// key) are covered in ../content-pipeline.test.ts — since Unit 12 the
// activity needs an activity Context and mocked repos, which live there.
