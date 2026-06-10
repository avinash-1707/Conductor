import { describe, expect, it, vi } from "vitest";
import { ApplicationFailure } from "@temporalio/activity";
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

// Activity failure branches. Mock env so the missing-key path is deterministic
// regardless of the shell, and so no real OpenRouter call is ever attempted.
vi.mock("../../env", () => ({
  env: { OPENROUTER_API_KEY: undefined, RESEARCH_MODEL: "anthropic/claude-sonnet-4.5" },
}));

describe("research activity", () => {
  it("throws non-retryably on invalid input", async () => {
    const { research } = await import("../content-pipeline");
    try {
      await research({ topic: "", keywords: [], tone: "technical" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).type).toBe("InvalidResearchInput");
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
    }
  });

  it("throws non-retryably when the OpenRouter key is absent", async () => {
    const { research } = await import("../content-pipeline");
    try {
      await research({ topic: "Topic", keywords: ["k"], tone: "technical" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApplicationFailure);
      expect((err as ApplicationFailure).type).toBe("MissingOpenRouterKey");
      expect((err as ApplicationFailure).nonRetryable).toBe(true);
    }
  });
});
