import { setTimeout as sleep } from "node:timers/promises";
import type { ResearchLLM } from "./research";
import type { WritingLLM } from "./writing";

/**
 * Deterministic mock model layer (Unit 23 — `LLM_MODE=mock`). Powers the
 * golden-path E2E's "stubbed model": the LangGraph graphs, projections,
 * streaming, approvals, and org-key path all run for real — only the model
 * calls are canned. Output is a pure function of the input (the activities
 * stay idempotent, invariant 2), and the streamed fields are emitted through
 * `onDelta` in word-sized chunks with realistic pacing so live streaming is
 * visible and assertable in the dashboard.
 */

export interface MockLLMOptions {
  onDelta?: (delta: string) => void;
  /** Pacing per streamed chunk; tests pass 0. */
  delayMs?: number;
}

const DEFAULT_DELAY_MS = 60;

/** Streams `text` word-by-word through `onDelta` (if any), then returns it. */
async function streamText(
  text: string,
  opts: MockLLMOptions,
): Promise<string> {
  const delay = opts.delayMs ?? DEFAULT_DELAY_MS;
  if (opts.onDelta) {
    const words = text.split(/(?<= )/);
    for (const word of words) {
      opts.onDelta(word);
      if (delay > 0) await sleep(delay);
    }
  }
  return text;
}

export function createMockResearchLLM(opts: MockLLMOptions = {}): ResearchLLM {
  return {
    async gatherSources(input) {
      if ((opts.delayMs ?? DEFAULT_DELAY_MS) > 0) await sleep(300);
      return {
        sources: [
          {
            title: `Field guide: ${input.topic}`,
            url: "https://example.com/mock/field-guide",
            takeaway: `Practical grounding for "${input.topic}" aimed at a ${input.tone} audience.`,
          },
          {
            title: `Why ${input.keywords[0] ?? "this topic"} matters`,
            url: "https://example.com/mock/why-it-matters",
            takeaway: "Industry context and the common failure modes to address.",
          },
        ],
        notes: `Canned synthesis notes connecting ${input.keywords.join(", ")} to the topic.`,
      };
    },

    async synthesize(input) {
      const summary =
        `Mock research synthesis for "${input.topic}": the gathered sources agree that ` +
        `${input.keywords.join(" and ")} are the load-bearing themes, and that a ${input.tone} ` +
        `treatment should lead with concrete failure modes before introducing the solution. ` +
        `This summary streams word by word so the dashboard's live output panel can be verified end to end.`;
      await streamText(summary, opts);
      return {
        summary,
        keyPoints: [
          `Anchor the piece on ${input.keywords[0] ?? input.topic}.`,
          "Lead with the operational pain, not the architecture.",
          "Close with a concrete, verifiable claim.",
        ],
      };
    },
  };
}

export function createMockWritingLLM(opts: MockLLMOptions = {}): WritingLLM {
  return {
    async outline(input) {
      if ((opts.delayMs ?? DEFAULT_DELAY_MS) > 0) await sleep(300);
      return {
        outline: [
          `Why ${input.topic} is hard`,
          ...input.findings.keyPoints.slice(0, 2),
          "What to do about it",
        ],
      };
    },

    async draft(input) {
      const title = `${input.topic}: a ${input.tone} guide`;
      const markdown =
        `# ${title}\n\n` +
        `${input.findings.summary}\n\n` +
        input.outline.map((h) => `## ${h}\n\nMock section grounded in the research above.`).join("\n\n") +
        `\n\nKeywords: ${input.keywords.join(", ")}.`;
      await streamText(markdown, opts);
      return { title, markdown };
    },

    async refine(input) {
      // Deterministic no-op refine — the draft already carries the content.
      return input.draft;
    },
  };
}
