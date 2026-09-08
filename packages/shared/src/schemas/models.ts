import { z } from "zod";

/**
 * Org model selection (Unit 33). An org owner picks which OpenRouter models
 * the research and writing agents run on; `null` means the platform default.
 * The catalog the picker offers is server-curated from OpenRouter's public
 * model list — these schemas are the cross-boundary contract for both.
 */

/** An OpenRouter model slug: `provider/model[:tag]` (e.g. `anthropic/claude-opus-4.8`). */
export const modelIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9-]+\/[a-zA-Z0-9._:-]+$/, "Expected an OpenRouter `provider/model` slug");
export type ModelId = z.infer<typeof modelIdSchema>;

/** Execution intent, independent of a customer's chosen provider/model slug. */
export const modelTierSchema = z.enum(["fast", "quality"]);
export type ModelTier = z.infer<typeof modelTierSchema>;

/** One selectable catalog entry. Paid models (`free: false`) get the star marker in the UI. */
export const modelOptionSchema = z.object({
  id: modelIdSchema,
  name: z.string().min(1),
  /** Display group: `anthropic` / `openai` / `google` for the paid picks, the id's prefix for free ones. */
  provider: z.string().min(1),
  free: z.boolean(),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;

/** `GET /orgs/models` — the curated catalog, paid picks first, free picks last. */
export const modelCatalogResponseSchema = z.object({
  models: z.array(modelOptionSchema),
});
export type ModelCatalogResponse = z.infer<typeof modelCatalogResponseSchema>;

/** The org's stored choice; `null` = use the platform default. */
export const orgModelSettingsSchema = z.object({
  researchModel: modelIdSchema.nullable(),
  writingModel: modelIdSchema.nullable(),
});
export type OrgModelSettings = z.infer<typeof orgModelSettingsSchema>;

/** `PUT /orgs/model-settings` body — a full replace (both fields, no partial patch). */
export const updateOrgModelSettingsSchema = orgModelSettingsSchema;
export type UpdateOrgModelSettings = OrgModelSettings;

/** `GET /orgs/model-settings` — the stored choice plus the platform defaults for display. */
export const orgModelSettingsResponseSchema = z.object({
  settings: orgModelSettingsSchema,
  defaults: z.object({
    research: modelIdSchema,
    writing: modelIdSchema,
  }),
});
export type OrgModelSettingsResponse = z.infer<typeof orgModelSettingsResponseSchema>;
