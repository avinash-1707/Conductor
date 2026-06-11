import type { FastifyPluginAsync } from "fastify";
import {
  DEFAULT_RESEARCH_MODEL,
  DEFAULT_WRITING_MODEL,
  modelCatalogResponseSchema,
  redisKeys,
  updateOrgModelSettingsSchema,
  type ModelCatalogResponse,
  type ModelOption,
  type OrgModelSettingsResponse,
} from "@conductor/shared";
import { AppError, ValidationError } from "../errors";
import { activeOrgId } from "../lib/active-org";
import { createModelCatalogFetcher } from "../lib/openrouter";
import { cacheDelete } from "../cache";
import { repos } from "../repos/index";

/**
 * Org model selection (Unit 33).
 *
 * - `GET /orgs/models`        — any member: the curated OpenRouter catalog.
 * - `GET /orgs/model-settings` — any member: the org's choice + platform defaults.
 * - `PUT /orgs/model-settings` — owner-only: replace the choice (null = default)
 *   and invalidate the worker's 10-minute Redis cache so the next run picks the
 *   new models up immediately.
 *
 * Model ids are validated by shape only, deliberately not against the live
 * catalog: the catalog is a curated, rotating subset — a stale-but-real slug
 * must never brick saved settings (spec decision).
 */
export function modelSettingsRoutes(deps?: {
  /** Test seam — defaults to the cached OpenRouter fetcher. */
  catalog?: () => Promise<ModelOption[]>;
}): FastifyPluginAsync {
  const catalog = deps?.catalog ?? createModelCatalogFetcher();

  return async (app) => {
    app.get(
      "/orgs/models",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req): Promise<ModelCatalogResponse> => {
        let models: ModelOption[];
        try {
          models = await catalog();
        } catch (err) {
          req.log.warn({ err }, "model catalog fetch failed");
          throw new AppError(
            "We couldn't load the model list. Try again.",
            "model_catalog_unavailable",
            502,
          );
        }
        return modelCatalogResponseSchema.parse({ models });
      },
    );

    app.get(
      "/orgs/model-settings",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req): Promise<OrgModelSettingsResponse> => {
        const orgId = activeOrgId(req);
        const row = await repos.modelSettings.findOrgModelSettings({ orgId });
        return {
          settings: {
            researchModel: row?.researchModel ?? null,
            writingModel: row?.writingModel ?? null,
          },
          defaults: { research: DEFAULT_RESEARCH_MODEL, writing: DEFAULT_WRITING_MODEL },
        };
      },
    );

    app.put(
      "/orgs/model-settings",
      { preHandler: (req, reply) => app.requireOwner(req, reply) },
      async (req): Promise<OrgModelSettingsResponse> => {
        const parsed = updateOrgModelSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ValidationError(
            "Model choices must be OpenRouter model ids (or null for the default)",
          );
        }
        const orgId = activeOrgId(req);
        const row = await repos.modelSettings.upsertOrgModelSettings({
          orgId,
          researchModel: parsed.data.researchModel,
          writingModel: parsed.data.writingModel,
        });
        // Best-effort: a missed invalidation only means the worker's cached
        // value lives out its 10-minute TTL.
        const invalidated = await cacheDelete(redisKeys.orgModelSettings(orgId));
        if (!invalidated) {
          req.log.warn({ orgId }, "model settings cache invalidation failed");
        }
        req.log.info(
          {
            event: "org_models.updated",
            orgId,
            researchModel: row.researchModel,
            writingModel: row.writingModel,
          },
          "org model settings updated",
        );
        return {
          settings: { researchModel: row.researchModel, writingModel: row.writingModel },
          defaults: { research: DEFAULT_RESEARCH_MODEL, writing: DEFAULT_WRITING_MODEL },
        };
      },
    );
  };
}
