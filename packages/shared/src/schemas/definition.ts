import { z } from "zod";

import { blogPostPipelineInputSchema } from "./blog-pipeline";
import { graphSpecSchema } from "./graph-spec";
import { templateCatalog, templateKeySchema } from "./template";

/**
 * Workflow-definition API contracts (Units 30/32) — the `workflow_definitions`
 * version rows runs pin via `definition_id`. Unit 30 reads them (the canvas
 * viewer); Unit 32 writes them (save-as-new-version) and launches runs from
 * them through the same interpreter every template runs on.
 */

export const definitionResourceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  version: z.number().int().positive(),
  /** Nullable: pre-Unit-24 rows were created before specs existed. */
  graphSpec: graphSpecSchema.nullable(),
  /** The catalog template this row was seeded from; null for canvas-authored rows. */
  templateKey: templateKeySchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type DefinitionResource = z.infer<typeof definitionResourceSchema>;

/** `GET /definitions` — latest-per-name list (or one name's version history). */
export const definitionListResponseSchema = z.object({
  items: z.array(definitionResourceSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type DefinitionListResponse = z.infer<typeof definitionListResponseSchema>;

/**
 * Names the template seeder owns — a canvas save under one of these would
 * interleave with the template's own version line (Unit 32 decision).
 */
export const reservedDefinitionNames: ReadonlySet<string> = new Set(
  Object.values(templateCatalog).map((t) => t.name.toLowerCase()),
);

/**
 * `POST /definitions` — save the drawn spec as the next immutable version of
 * `spec.name`. Shared between the editor (narrates before saving) and the
 * server boundary, so both reject reserved names with the same message.
 */
export const saveDefinitionRequestSchema = z
  .object({
    graphSpec: graphSpecSchema,
    description: z.string().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (reservedDefinitionNames.has(value.graphSpec.name.toLowerCase())) {
      ctx.addIssue({
        code: "custom",
        message: `"${value.graphSpec.name}" is a built-in template name — pick another name`,
        path: ["graphSpec", "name"],
        params: { code: "reserved_template_name" },
      });
    }
  });
export type SaveDefinitionRequest = z.infer<typeof saveDefinitionRequestSchema>;

/**
 * `POST /definitions/:id/runs` — canvas launches ride the engine parameter
 * contract via the blog identity mapping (Unit 32 decision 1): the interpreter
 * validates params against the blog template's schema, whose engine mapping is
 * the identity, so this is exact — no second dispatch path.
 */
export const launchDefinitionRunSchema = z.object({
  params: blogPostPipelineInputSchema,
});
export type LaunchDefinitionRunRequest = z.infer<typeof launchDefinitionRunSchema>;
