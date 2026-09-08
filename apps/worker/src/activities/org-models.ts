import Redis from "ioredis";
import {
  ORG_MODEL_SETTINGS_TTL_SECONDS,
  MODEL_TIER_BY_STEP,
  orgModelSettingsSchema,
  redisKeys,
  type ModelTier,
  type OrgModelSettings,
} from "@conductor/shared";
import { env } from "../env";
import { repos } from "../db";
import { logger } from "../logger";

/**
 * Resolves the org's chosen models for the agent steps (Unit 33): the
 * `org_model_settings` row read through a 10-minute Redis cache (operator
 * decision), with per-field fallback to the platform defaults from env.
 * The server DELs the cache key on every settings update, so a change
 * applies to the very next step.
 *
 * The cache is BEST-EFFORT like the realtime publisher: Redis being down
 * means a Postgres read per step, never a failed activity. Postgres errors
 * stay retryable (no classification — a projection-style read).
 */
export interface ResolvedOrgModels {
  researchModel: string;
  writingModel: string;
  researchTier: ModelTier;
  writingTier: ModelTier;
}

let client: Redis | undefined;

function redis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on("error", (err) => {
      logger.warn({ err }, "org-models cache redis error");
    });
  }
  return client;
}

/** Lazy first-use connect: without it the first command races the handshake
 *  (offline queueing is off) and the cache would silently miss every boot.
 *  Connect failures are swallowed — commands then fail fast into the
 *  best-effort fallbacks below. */
async function ready(): Promise<Redis> {
  const c = redis();
  if (c.status === "wait") {
    await c.connect().catch(() => undefined);
  }
  return c;
}

async function readCache(orgId: string): Promise<OrgModelSettings | undefined> {
  try {
    const raw = await (await ready()).get(redisKeys.orgModelSettings(orgId));
    if (!raw) return undefined;
    const parsed = orgModelSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

async function writeCache(orgId: string, settings: OrgModelSettings): Promise<void> {
  try {
    await (await ready()).set(
      redisKeys.orgModelSettings(orgId),
      JSON.stringify(settings),
      "EX",
      ORG_MODEL_SETTINGS_TTL_SECONDS,
    );
  } catch {
    // Best-effort — next read falls through to Postgres again.
  }
}

export async function resolveOrgModels(orgId: string): Promise<ResolvedOrgModels> {
  let settings = await readCache(orgId);
  if (!settings) {
    const row = await repos.modelSettings.findOrgModelSettings({ orgId });
    settings = {
      researchModel: row?.researchModel ?? null,
      writingModel: row?.writingModel ?? null,
    };
    await writeCache(orgId, settings);
  }
  return {
    researchModel: settings.researchModel ?? env.RESEARCH_MODEL,
    writingModel: settings.writingModel ?? env.WRITING_MODEL,
    researchTier: MODEL_TIER_BY_STEP.research,
    writingTier: MODEL_TIER_BY_STEP.writing,
  };
}

/** Drains the cache connection on worker shutdown. */
export async function closeOrgModelsCache(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = undefined;
  }
}
