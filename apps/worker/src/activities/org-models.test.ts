import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import {
  ORG_MODEL_SETTINGS_TTL_SECONDS,
  redisKeys,
} from "@conductor/shared";

/**
 * Org model resolution (Unit 33): the org_model_settings read through the
 * 10-minute Redis cache, with per-field fallback to the platform defaults.
 * Uses the real local Redis (like the server's io tests) and a mocked repo.
 */

vi.mock("../env", () => ({
  env: {
    REDIS_URL: "redis://localhost:6379",
    RESEARCH_MODEL: "anthropic/claude-sonnet-4.5",
    WRITING_MODEL: "anthropic/claude-opus-4.8",
  },
}));

vi.mock("../db", () => ({
  repos: {
    modelSettings: {
      findOrgModelSettings: vi.fn(),
    },
  },
}));

import { repos } from "../db";
import { closeOrgModelsCache, resolveOrgModels } from "./org-models";

const redis = new Redis("redis://localhost:6379");

function row(orgId: string, researchModel: string | null, writingModel: string | null) {
  return {
    id: randomUUID(),
    orgId,
    researchModel,
    writingModel,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await closeOrgModelsCache();
  redis.disconnect();
});

describe("resolveOrgModels", () => {
  it("falls back to the platform defaults when the org has no row", async () => {
    const orgId = `org-${randomUUID()}`;
    vi.mocked(repos.modelSettings.findOrgModelSettings).mockResolvedValue(undefined);

    expect(await resolveOrgModels(orgId)).toEqual({
      researchModel: "anthropic/claude-sonnet-4.5",
      writingModel: "anthropic/claude-opus-4.8",
      researchTier: "fast",
      writingTier: "quality",
    });
  });

  it("applies the org's choice per field (partial override)", async () => {
    const orgId = `org-${randomUUID()}`;
    vi.mocked(repos.modelSettings.findOrgModelSettings).mockResolvedValue(
      row(orgId, "google/gemini-3.5-flash", null),
    );

    expect(await resolveOrgModels(orgId)).toEqual({
      researchModel: "google/gemini-3.5-flash",
      writingModel: "anthropic/claude-opus-4.8",
      researchTier: "fast",
      writingTier: "quality",
    });
  });

  it("caches the settings in Redis with the 10-minute TTL and skips Postgres on a hit", async () => {
    const orgId = `org-${randomUUID()}`;
    vi.mocked(repos.modelSettings.findOrgModelSettings).mockResolvedValue(
      row(orgId, "openai/gpt-5.5", "openai/gpt-5.5-pro"),
    );

    await resolveOrgModels(orgId);
    expect(repos.modelSettings.findOrgModelSettings).toHaveBeenCalledTimes(1);

    const key = redisKeys.orgModelSettings(orgId);
    expect(JSON.parse((await redis.get(key))!)).toEqual({
      researchModel: "openai/gpt-5.5",
      writingModel: "openai/gpt-5.5-pro",
    });
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ORG_MODEL_SETTINGS_TTL_SECONDS);

    // Second resolution rides the cache — no second Postgres read.
    await resolveOrgModels(orgId);
    expect(repos.modelSettings.findOrgModelSettings).toHaveBeenCalledTimes(1);
  });

  it("re-reads Postgres after the cache key is invalidated (the server's DEL)", async () => {
    const orgId = `org-${randomUUID()}`;
    vi.mocked(repos.modelSettings.findOrgModelSettings).mockResolvedValue(
      row(orgId, "openai/gpt-5.5", null),
    );
    await resolveOrgModels(orgId);

    await redis.del(redisKeys.orgModelSettings(orgId));
    vi.mocked(repos.modelSettings.findOrgModelSettings).mockResolvedValue(
      row(orgId, "google/gemini-3.5-flash", null),
    );

    expect((await resolveOrgModels(orgId)).researchModel).toBe("google/gemini-3.5-flash");
    expect(repos.modelSettings.findOrgModelSettings).toHaveBeenCalledTimes(2);
  });

  it("ignores a corrupt cache entry and falls through to Postgres", async () => {
    const orgId = `org-${randomUUID()}`;
    await redis.set(redisKeys.orgModelSettings(orgId), "{not json");
    vi.mocked(repos.modelSettings.findOrgModelSettings).mockResolvedValue(
      row(orgId, null, "openai/gpt-5.5-pro"),
    );

    expect((await resolveOrgModels(orgId)).writingModel).toBe("openai/gpt-5.5-pro");
    expect(repos.modelSettings.findOrgModelSettings).toHaveBeenCalledTimes(1);
  });
});
