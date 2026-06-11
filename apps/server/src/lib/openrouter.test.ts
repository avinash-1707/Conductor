import { describe, expect, it, vi } from "vitest";
import {
  curateModels,
  createModelCatalogFetcher,
  verifyOpenRouterKey,
  type FetchImpl,
} from "./openrouter";

/** Fixture entry in OpenRouter's /models shape (only the curated slice matters). */
function raw(
  id: string,
  created: number,
  opts?: { prompt?: string; completion?: string; out?: string[]; name?: string },
) {
  return {
    id,
    name: opts?.name ?? id,
    created,
    pricing: { prompt: opts?.prompt ?? "0.00001", completion: opts?.completion ?? "0.00002" },
    architecture: { output_modalities: opts?.out ?? ["text"] },
  };
}

const FIXTURE = [
  // anthropic: flagship pair + noise that must lose
  raw("anthropic/claude-fable-5", 100),
  raw("anthropic/claude-opus-4.8-fast", 99), // noise: -fast
  raw("anthropic/claude-opus-4.8", 98),
  raw("anthropic/claude-opus-4.7", 97), // third — cut by top-2
  // openai: image + tag variants must lose
  raw("openai/gpt-5.5-pro", 90),
  raw("openai/gpt-5.4-image-2", 89, { out: ["image"] }),
  raw("openai/gpt-chat-latest", 88), // noise: chat-latest
  raw("openai/gpt-5.5", 87),
  raw("openai/gpt-5.5:extended", 86), // tag variant
  // google
  raw("google/gemini-3.5-flash", 80),
  raw("google/gemini-3.1-flash-lite", 79),
  // free picks (newest 4 win), safety classifier excluded
  raw("nvidia/nemotron-3-ultra:free", 70, { prompt: "0", completion: "0" }),
  raw("nvidia/nemotron-safety:free", 69, { prompt: "0", completion: "0" }), // noise: safety
  raw("google/gemma-4-31b-it:free", 68, { prompt: "0", completion: "0" }),
  raw("meta-llama/llama-5:free", 67, { prompt: "0", completion: "0" }),
  raw("qwen/qwen-4:free", 66, { prompt: "0", completion: "0" }),
  raw("mistralai/mistral-9:free", 65, { prompt: "0", completion: "0" }), // fifth — cut
  // malformed entries must be dropped, not fatal
  { id: "broken" },
  null,
];

describe("curateModels", () => {
  const models = curateModels(FIXTURE);

  it("picks the newest two flagship paid models per curated provider, in provider order", () => {
    expect(models.filter((m) => !m.free).map((m) => m.id)).toEqual([
      "anthropic/claude-fable-5",
      "anthropic/claude-opus-4.8",
      "openai/gpt-5.5-pro",
      "openai/gpt-5.5",
      "google/gemini-3.5-flash",
      "google/gemini-3.1-flash-lite",
    ]);
  });

  it("marks paid picks for the star and free picks not", () => {
    expect(models.filter((m) => !m.free)).toHaveLength(6);
    for (const m of models.filter((m) => m.free)) expect(m.id).toContain(":free");
  });

  it("appends the newest four free text models, excluding noise variants", () => {
    expect(models.filter((m) => m.free).map((m) => m.id)).toEqual([
      "nvidia/nemotron-3-ultra:free",
      "google/gemma-4-31b-it:free",
      "meta-llama/llama-5:free",
      "qwen/qwen-4:free",
    ]);
  });

  it("excludes fast/image/tag/safety variants and survives malformed entries", () => {
    const ids = models.map((m) => m.id);
    expect(ids).not.toContain("anthropic/claude-opus-4.8-fast");
    expect(ids).not.toContain("openai/gpt-5.4-image-2");
    expect(ids).not.toContain("openai/gpt-chat-latest");
    expect(ids).not.toContain("openai/gpt-5.5:extended");
    expect(ids).not.toContain("nvidia/nemotron-safety:free");
  });
});

describe("createModelCatalogFetcher", () => {
  function okFetch() {
    return vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: FIXTURE }),
    }));
  }

  it("fetches once and serves the cache within the TTL", async () => {
    const fetchImpl = okFetch();
    let clock = 0;
    const fetcher = createModelCatalogFetcher({
      fetchImpl,
      now: () => clock,
      ttlMs: 1000,
    });

    const first = await fetcher();
    clock = 999;
    const second = await fetcher();
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock = 1001;
    await fetcher();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("throws on an upstream error without caching", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    const fetcher = createModelCatalogFetcher({ fetchImpl, now: () => 0 });
    await expect(fetcher()).rejects.toThrow("503");
    await expect(fetcher()).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats a response that curates to zero entries as an upstream failure", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "broken" }] }),
    }));
    const fetcher = createModelCatalogFetcher({ fetchImpl, now: () => 0 });
    await expect(fetcher()).rejects.toThrow("zero entries");
  });
});

describe("verifyOpenRouterKey", () => {
  const respond = (status: number): FetchImpl =>
    vi.fn(async () => ({ ok: status < 400, status, json: async () => ({}) }));

  it("maps 200 → valid, 401/403 → invalid, 5xx/network → unavailable", async () => {
    expect(await verifyOpenRouterKey("sk-or-x", respond(200))).toBe("valid");
    expect(await verifyOpenRouterKey("sk-or-x", respond(401))).toBe("invalid");
    expect(await verifyOpenRouterKey("sk-or-x", respond(403))).toBe("invalid");
    expect(await verifyOpenRouterKey("sk-or-x", respond(503))).toBe("unavailable");
    expect(
      await verifyOpenRouterKey("sk-or-x", async () => {
        throw new Error("network down");
      }),
    ).toBe("unavailable");
  });

  it("sends the key as the bearer token to the key endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    await verifyOpenRouterKey("sk-or-abc", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({ headers: { authorization: "Bearer sk-or-abc" } }),
    );
  });
});
