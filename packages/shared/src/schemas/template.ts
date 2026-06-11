import { z } from "zod";

import { blogPostPipelineInputSchema, blogToneSchema } from "./blog-pipeline";
import { blogPostPipelineSpec, type GraphSpec } from "./graph-spec";

/**
 * The template catalog (Unit 26) — curated, code-defined templates with the
 * per-template parameter schema the launch form is generated from
 * (project-overview Templates). One source of truth for three consumers: the
 * server validates launch params and seeds the org's `workflow_definitions`
 * rows from it, the interpreter workflow re-validates its input against it
 * (pure data + Zod — sandbox-safe), and the web library renders the launch
 * form from its field descriptors.
 *
 * Templates are code-curated, DB-pinned: the catalog defines what a template
 * IS; `workflow_definitions` rows are the per-org immutable versions runs pin
 * via `definition_id`. There is no template-authoring API in v1 — the canvas
 * (Phase 5) becomes the authoring surface over the same graph_spec model.
 */

export const templateKeySchema = z.enum(["blog-post-pipeline"]);
export type TemplateKey = z.infer<typeof templateKeySchema>;

/**
 * Form-generation descriptors — how the library renders each parameter. One
 * field per parameter schema key (a catalog test enforces the mirror), so the
 * generated form and the validation contract can never drift.
 */
export const templateFieldSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    name: z.string().min(1),
    label: z.string().min(1),
    placeholder: z.string().optional(),
    hint: z.string().optional(),
    maxLength: z.number().int().positive(),
  }),
  z.object({
    /** Comma-separated list input — parsed into `string[]` before validation. */
    kind: z.literal("csv"),
    name: z.string().min(1),
    label: z.string().min(1),
    placeholder: z.string().optional(),
    hint: z.string().optional(),
    maxItems: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal("select"),
    name: z.string().min(1),
    label: z.string().min(1),
    options: z.array(z.string().min(1)).min(1),
    defaultValue: z.string().optional(),
  }),
  z.object({
    kind: z.literal("number"),
    name: z.string().min(1),
    label: z.string().min(1),
    min: z.number().int(),
    max: z.number().int(),
    defaultValue: z.number().int().optional(),
  }),
  z.object({
    /** Org-member select, defaulting to the launching user. */
    kind: z.literal("approver"),
    name: z.string().min(1),
    label: z.string().min(1),
  }),
]);
export type TemplateField = z.infer<typeof templateFieldSchema>;

export interface TemplateDefinition {
  key: TemplateKey;
  /** Customer-facing name — always equals `spec.name` (dashboard vocabulary). */
  name: string;
  description: string;
  spec: GraphSpec;
  /** The per-template parameter contract the launch form is generated from. */
  paramsSchema: z.ZodType;
  fields: TemplateField[];
}

/**
 * `satisfies` (not a type annotation) so each entry keeps its concrete schema
 * type — `templateCatalog["blog-post-pipeline"].paramsSchema.parse(...)`
 * returns `BlogPostPipelineInput`, no cast anywhere.
 */
export const templateCatalog = {
  "blog-post-pipeline": {
    key: "blog-post-pipeline",
    name: blogPostPipelineSpec.name,
    description:
      "research → approval → write → publish. Research streams live, pauses for your reviewer, then drafts and delivers.",
    spec: blogPostPipelineSpec,
    paramsSchema: blogPostPipelineInputSchema,
    fields: [
      {
        kind: "text",
        name: "topic",
        label: "Topic",
        placeholder: "Why durable workflows stop AI runs from vanishing",
        maxLength: 200,
      },
      {
        kind: "csv",
        name: "keywords",
        label: "Target keywords",
        placeholder: "durable execution, ai pipelines",
        hint: "Comma-separated, up to 10.",
        maxItems: 10,
      },
      {
        kind: "select",
        name: "tone",
        label: "Tone",
        options: [...blogToneSchema.options],
        defaultValue: "professional",
      },
      {
        kind: "number",
        name: "wordCount",
        label: "Word count",
        min: 100,
        max: 5000,
        defaultValue: 1200,
      },
      { kind: "approver", name: "approverId", label: "Who approves" },
    ],
  },
} satisfies Record<TemplateKey, TemplateDefinition>;

/**
 * Shape stored in `workflow_definitions.parameters` — links a definition row
 * back to its catalog entry (the column is already a JSONB record; no
 * migration). Parse on read at the boundary (code-standards Data & Storage).
 */
export const definitionParametersSchema = z.object({
  templateKey: templateKeySchema,
});
export type DefinitionParameters = z.infer<typeof definitionParametersSchema>;

/** `GET /templates` — catalog entries with the org's pinned definition row. */
export const templateResourceSchema = z.object({
  key: templateKeySchema,
  name: z.string().min(1),
  description: z.string().min(1),
  definitionId: z.uuid(),
  version: z.number().int().positive(),
});
export type TemplateResource = z.infer<typeof templateResourceSchema>;

export const templateListResponseSchema = z.object({
  items: z.array(templateResourceSchema),
});
export type TemplateListResponse = z.infer<typeof templateListResponseSchema>;

/**
 * `POST /runs` request body — a template launch. `params` is validated against
 * the template's own schema (validation IS the schema, Unit 24 principle);
 * `orgId` never rides in a body (invariant 11).
 */
export const launchRunRequestSchema = z
  .object({
    templateKey: templateKeySchema,
    params: z.record(z.string(), z.unknown()),
  })
  .superRefine((value, ctx) => {
    const schema: z.ZodType = templateCatalog[value.templateKey].paramsSchema;
    const parsed = schema.safeParse(value.params);
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: `params do not match template "${value.templateKey}": ${parsed.error.message}`,
        path: ["params"],
      });
    }
  });
export type LaunchRunRequest = z.infer<typeof launchRunRequestSchema>;
