import { describe, expect, it, vi } from "vitest";
import { blogDraftSchema, type ResearchFindings } from "@conductor/shared";
import { runWriting, type WritingInput, type WritingLLM } from "./writing";

const FINDINGS: ResearchFindings = {
  summary: "Durable execution keeps AI pipelines running across failures.",
  sources: [
    { title: "Temporal docs", url: "https://docs.temporal.io/", takeaway: "Workflows recover." },
  ],
  keyPoints: ["Replay restores state.", "Activities must be idempotent."],
};

const INPUT: WritingInput = {
  topic: "Durable AI workflows",
  keywords: ["temporal", "reliability"],
  tone: "technical",
  wordCount: 800,
  findings: FINDINGS,
};

const REFINED = {
  title: "Why Durable Workflows Win",
  markdown: "# Why Durable Workflows Win\n\nDurable execution means runs survive crashes and resume cleanly.",
};

function fakeLLM(overrides: Partial<WritingLLM> = {}): WritingLLM {
  return {
    outline: vi.fn(async () => ({ outline: ["Intro", "How it works", "Conclusion"] })),
    draft: vi.fn(async () => ({ title: "Draft", markdown: "# Draft\n\nFirst pass." })),
    refine: vi.fn(async () => REFINED),
    ...overrides,
  };
}

describe("writing graph", () => {
  it("produces a schema-valid BlogDraft with a computed word count", async () => {
    const llm = fakeLLM();
    const draft = await runWriting(INPUT, llm);

    expect(() => blogDraftSchema.parse(draft)).not.toThrow();
    expect(draft.title).toBe(REFINED.title);
    expect(draft.markdown).toBe(REFINED.markdown);
    // wordCount is computed from the refined markdown, not taken from the model.
    expect(draft.wordCount).toBe(
      REFINED.markdown.trim().split(/\s+/).filter(Boolean).length,
    );
    expect(llm.outline).toHaveBeenCalledTimes(1);
    expect(llm.draft).toHaveBeenCalledTimes(1);
    expect(llm.refine).toHaveBeenCalledTimes(1);
  });

  it("threads the first draft into the refine step", async () => {
    const refine = vi.fn(async () => REFINED);
    const llm = fakeLLM({ refine });
    await runWriting(INPUT, llm);

    expect(refine).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: { title: "Draft", markdown: "# Draft\n\nFirst pass." },
      }),
    );
  });

  it("fails at finalize when the model returns an empty body", async () => {
    const llm = fakeLLM({ refine: vi.fn(async () => ({ title: "x", markdown: "" })) });
    await expect(runWriting(INPUT, llm)).rejects.toThrow();
  });
});
