import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchFindings } from "@conductor/shared";

/**
 * Unit 20 — token streaming. The OpenRouter-backed agents stream the
 * user-visible field token-by-token via `streamObject` while still RETURNING
 * the final validated object (which becomes the activity result and thus the
 * Temporal payload). These tests mock the AI SDK so they assert that contract
 * without a network: deltas are forwarded as a side channel; the structured
 * object is the return value (architecture invariant 8).
 */

const { streamObjectMock, generateObjectMock } = vi.hoisted(() => ({
  streamObjectMock: vi.fn(),
  generateObjectMock: vi.fn(),
}));

vi.mock("ai", () => ({
  streamObject: streamObjectMock,
  generateObject: generateObjectMock,
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => ({ chat: () => ({ id: "fake-model" }) }),
}));

import { createOpenRouterResearchLLM } from "./research";
import { createOpenRouterWritingLLM } from "./writing";

/** A fake streamObject result: a partial-object stream + the resolved object. */
function fakeStream<T>(partials: unknown[], object: T) {
  return {
    partialObjectStream: (async function* () {
      for (const p of partials) yield p;
    })(),
    object: Promise.resolve(object),
  };
}

const FINDINGS: ResearchFindings = {
  summary: "s",
  sources: [{ title: "Src", url: "https://example.com", takeaway: "t" }],
  keyPoints: ["a"],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("research synthesize streaming", () => {
  it("forwards summary deltas and returns the validated object", async () => {
    const final = { summary: "Hello world", keyPoints: ["a", "b"] };
    streamObjectMock.mockReturnValue(
      fakeStream([{ summary: "Hel" }, { summary: "Hello world" }], final),
    );

    const deltas: string[] = [];
    const llm = createOpenRouterResearchLLM({
      apiKey: "k",
      model: "m",
      onDelta: (d) => deltas.push(d),
    });
    const result = await llm.synthesize({
      topic: "t",
      keywords: ["k"],
      tone: "technical",
      sources: FINDINGS.sources,
      notes: "n",
    });

    // Suffix deltas reconstruct the streamed prose, no JSON noise.
    expect(deltas.join("")).toBe("Hello world");
    // The structured object is the return value (the Temporal payload).
    expect(result).toEqual(final);
    expect(streamObjectMock).toHaveBeenCalledTimes(1);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });

  it("falls back to generateObject (no stream) when no onDelta is given", async () => {
    generateObjectMock.mockResolvedValue({
      object: { summary: "x", keyPoints: ["a"] },
    });
    const llm = createOpenRouterResearchLLM({ apiKey: "k", model: "m" });
    const result = await llm.synthesize({
      topic: "t",
      keywords: ["k"],
      tone: "technical",
      sources: FINDINGS.sources,
      notes: "n",
    });

    expect(result).toEqual({ summary: "x", keyPoints: ["a"] });
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
    expect(streamObjectMock).not.toHaveBeenCalled();
  });
});

describe("writing draft streaming", () => {
  it("forwards markdown deltas and returns the validated draft", async () => {
    const final = { title: "Title", markdown: "# Title\n\nBody" };
    streamObjectMock.mockReturnValue(
      fakeStream([{ markdown: "# Ti" }, { markdown: "# Title\n\nBody" }], final),
    );

    const deltas: string[] = [];
    const llm = createOpenRouterWritingLLM({
      apiKey: "k",
      model: "m",
      onDelta: (d) => deltas.push(d),
    });
    const result = await llm.draft({
      topic: "t",
      keywords: ["k"],
      tone: "technical",
      wordCount: 500,
      findings: FINDINGS,
      outline: ["intro"],
    });

    expect(deltas.join("")).toBe("# Title\n\nBody");
    expect(result).toEqual(final);
    expect(streamObjectMock).toHaveBeenCalledTimes(1);
    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
