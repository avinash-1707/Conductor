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

const { streamObjectMock, generateObjectMock, NoObjectGeneratedErrorMock } = vi.hoisted(() => {
  class NoObjectGeneratedErrorMock extends Error {
    static isInstance(error: unknown): error is NoObjectGeneratedErrorMock {
      return error instanceof NoObjectGeneratedErrorMock;
    }
  }
  return {
    streamObjectMock: vi.fn(),
    generateObjectMock: vi.fn(),
    NoObjectGeneratedErrorMock,
  };
});

vi.mock("ai", () => ({
  streamObject: streamObjectMock,
  generateObject: generateObjectMock,
  NoObjectGeneratedError: NoObjectGeneratedErrorMock,
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
    usage: Promise.resolve({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
    providerMetadata: Promise.resolve({ openrouter: { usage: { cost: 0.001 } } }),
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
      tier: "fast",
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

  it("records provider usage and cost outside the returned object", async () => {
    const observations: unknown[] = [];
    streamObjectMock.mockReturnValue(
      fakeStream([{ summary: "ok" }], { summary: "ok", keyPoints: ["a"] }),
    );
    const llm = createOpenRouterResearchLLM({
      apiKey: "k",
      model: "m",
      tier: "fast",
      onDelta: () => undefined,
      onObservation: async (observation) => {
        observations.push(observation);
      },
    });

    await llm.synthesize({
      topic: "t",
      keywords: ["k"],
      tone: "technical",
      sources: FINDINGS.sources,
      notes: "n",
    });

    expect(observations).toEqual([
      expect.objectContaining({
        operation: "research.synthesize",
        model: "m",
        tier: "fast",
        promptVersion: "research.synthesize@v1",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        costUsd: 0.001,
        repaired: false,
      }),
    ]);
  });

  it("falls back to generateObject (no stream) when no onDelta is given", async () => {
    generateObjectMock.mockResolvedValue({
      object: { summary: "x", keyPoints: ["a"] },
    });
    const llm = createOpenRouterResearchLLM({ apiKey: "k", model: "m", tier: "fast" });
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
      tier: "quality",
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

  it("retries one malformed stream without appending repaired output to the live tail", async () => {
    const observations: unknown[] = [];
    streamObjectMock.mockReturnValueOnce({
      partialObjectStream: (async function* () {
        yield { markdown: "invalid partial" };
      })(),
      object: Promise.reject(new NoObjectGeneratedErrorMock("invalid output")),
      usage: Promise.resolve({ inputTokens: 3, outputTokens: 2, totalTokens: 5 }),
      providerMetadata: Promise.resolve(undefined),
    });
    generateObjectMock.mockResolvedValue({
      object: { title: "Fixed", markdown: "# Fixed" },
      usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 },
      providerMetadata: undefined,
    });
    const deltas: string[] = [];
    const llm = createOpenRouterWritingLLM({
      apiKey: "k",
      model: "m",
      tier: "quality",
      onDelta: (delta) => deltas.push(delta),
      onObservation: async (observation) => {
        observations.push(observation);
      },
    });

    const result = await llm.draft({
      topic: "t",
      keywords: ["k"],
      tone: "technical",
      wordCount: 500,
      findings: FINDINGS,
      outline: ["intro"],
    });

    expect(result).toEqual({ title: "Fixed", markdown: "# Fixed" });
    expect(deltas).toEqual(["invalid partial"]);
    expect(generateObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 0, system: expect.stringContaining("previous response") }),
    );
    expect(observations).toEqual([
      expect.objectContaining({ operation: "writing.draft", repaired: false }),
      expect.objectContaining({ operation: "writing.draft", repaired: true }),
    ]);
  });
});
