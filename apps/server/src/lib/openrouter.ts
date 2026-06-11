import { z } from "zod";
import { modelIdSchema, type ModelOption } from "@conductor/shared";

/**
 * The server's one OpenRouter surface (Unit 33): the curated model catalog
 * behind the Settings picker, and live verification of a submitted org key.
 * Both talk to OpenRouter's public API; neither ever attaches a customer key
 * except `verifyOpenRouterKey`, which sends exactly the key being verified.
 */

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const UPSTREAM_TIMEOUT_MS = 10_000;

/** The slice of OpenRouter's model object we curate on — extra fields ignored. */
const rawModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  created: z.number(),
  pricing: z.object({
    prompt: z.string(),
    completion: z.string(),
  }),
  architecture: z
    .object({ output_modalities: z.array(z.string()).optional() })
    .optional(),
});

const rawModelListSchema = z.object({
  // Individual entries that don't match the slice are dropped, not fatal —
  // OpenRouter adds fields/model kinds freely and the catalog must not break.
  data: z.array(z.unknown()),
});

type RawModel = z.infer<typeof rawModelSchema>;

/** Providers whose top models headline the picker, in display order. */
const CURATED_PROVIDERS = ["anthropic", "openai", "google"] as const;
const PAID_PICKS_PER_PROVIDER = 2;
const FREE_PICKS = 4;

/**
 * Variant noise excluded from the picks: speed/modality/special-purpose
 * spin-offs that would otherwise crowd out the flagship models ("-fast",
 * image models, safety classifiers, previews…). Matched as a delimited token
 * inside the model segment of the id.
 */
const NOISE_TOKENS = [
  "fast",
  "image",
  "audio",
  "video",
  "realtime",
  "search",
  "guard",
  "safety",
  "preview",
  "exp",
  "chat-latest",
];

function isNoisy(modelSegment: string): boolean {
  return NOISE_TOKENS.some((token) =>
    new RegExp(`(^|[-.:])${token}(?=$|[-.:])`).test(modelSegment),
  );
}

function isTextModel(model: RawModel): boolean {
  const out = model.architecture?.output_modalities;
  // Modalities missing → assume text (OpenRouter omits it on some text models).
  return out === undefined || out.includes("text");
}

function isFree(model: RawModel): boolean {
  return (
    model.id.endsWith(":free") ||
    (model.pricing.prompt === "0" && model.pricing.completion === "0")
  );
}

/** `anthropic/claude-opus-4.8:tag` → { provider: "anthropic", segment: "claude-opus-4.8:tag" } */
function splitId(id: string): { provider: string; segment: string } | null {
  const slash = id.indexOf("/");
  if (slash <= 0 || slash === id.length - 1) return null;
  return { provider: id.slice(0, slash), segment: id.slice(slash + 1) };
}

/**
 * Pure curation: the newest 2 paid flagship models from each curated provider
 * (no `:tag` variants, no noise) followed by the newest 4 free text models.
 * Deterministic over its input — unit-tested with a fixture.
 */
export function curateModels(rawEntries: unknown[]): ModelOption[] {
  const models: RawModel[] = [];
  for (const entry of rawEntries) {
    const parsed = rawModelSchema.safeParse(entry);
    if (parsed.success && modelIdSchema.safeParse(parsed.data.id).success) {
      models.push(parsed.data);
    }
  }

  const byNewest = (a: RawModel, b: RawModel) => b.created - a.created;
  const picks: ModelOption[] = [];

  for (const provider of CURATED_PROVIDERS) {
    const flagships = models
      .filter((m) => {
        const parts = splitId(m.id);
        return (
          parts !== null &&
          parts.provider === provider &&
          !parts.segment.includes(":") && // no :free/:extended/:thinking variants
          !isFree(m) &&
          !isNoisy(parts.segment) &&
          isTextModel(m)
        );
      })
      .sort(byNewest)
      .slice(0, PAID_PICKS_PER_PROVIDER);
    picks.push(
      ...flagships.map((m) => ({ id: m.id, name: m.name, provider, free: false })),
    );
  }

  const freePicks = models
    .filter((m) => {
      const parts = splitId(m.id);
      return (
        parts !== null &&
        isFree(m) &&
        !isNoisy(parts.segment.replace(/:free$/, "")) &&
        isTextModel(m) &&
        // A free pick must not duplicate a paid pick's provider entry shape-wise;
        // it just needs to be a real text model. Skip ones already picked.
        !picks.some((p) => p.id === m.id)
      );
    })
    .sort(byNewest)
    .slice(0, FREE_PICKS)
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: splitId(m.id)!.provider,
      free: true,
    }));

  return [...picks, ...freePicks];
}

export type FetchImpl = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Catalog fetcher with an in-memory cache (the list is public data; one
 * upstream hit per TTL per server process). All collaborators injectable so
 * tests never touch the network or the clock.
 */
export function createModelCatalogFetcher(opts?: {
  fetchImpl?: FetchImpl;
  now?: () => number;
  ttlMs?: number;
}) {
  const fetchImpl = opts?.fetchImpl ?? (fetch as unknown as FetchImpl);
  const now = opts?.now ?? Date.now;
  const ttlMs = opts?.ttlMs ?? 60 * 60 * 1000;
  let cache: { at: number; models: ModelOption[] } | null = null;

  return async function fetchModelCatalog(): Promise<ModelOption[]> {
    if (cache && now() - cache.at < ttlMs) return cache.models;
    const res = await fetchImpl(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter models endpoint returned ${res.status}`);
    }
    const body = rawModelListSchema.parse(await res.json());
    const models = curateModels(body.data);
    if (models.length === 0) {
      // An empty curation means the response shape drifted — treat as upstream
      // failure rather than caching an unusable catalog.
      throw new Error("OpenRouter model list curated to zero entries");
    }
    cache = { at: now(), models };
    return models;
  };
}

export type KeyVerification = "valid" | "invalid" | "unavailable";

/**
 * Live BYOK verification (operator request, Unit 33): GET /api/v1/key with the
 * submitted key. 200 → valid; 401/403 → invalid; anything else (timeout, 5xx,
 * network) → unavailable, and the caller decides (the route fails open). The
 * key is sent to OpenRouter only — never logged here or anywhere else.
 */
export async function verifyOpenRouterKey(
  apiKey: string,
  fetchImpl: FetchImpl = fetch as unknown as FetchImpl,
): Promise<KeyVerification> {
  try {
    const res = await fetchImpl(OPENROUTER_KEY_URL, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    if (res.ok) return "valid";
    if (res.status === 401 || res.status === 403) return "invalid";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}
