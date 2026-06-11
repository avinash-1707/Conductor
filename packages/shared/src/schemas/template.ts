import { z } from "zod";

import { blogPostPipelineInputSchema, blogToneSchema } from "./blog-pipeline";
import {
  GRAPH_SPEC_VERSION,
  blogPostPipelineSpec,
  graphSpecSchema,
  type GraphSpec,
} from "./graph-spec";

/**
 * The template catalog (Unit 26; SEO Brief + Competitor Research in Unit 29) —
 * curated, code-defined templates with the per-template parameter schema the
 * launch form is generated from (project-overview Templates). One source of
 * truth for three consumers: the server validates launch params and seeds the
 * org's `workflow_definitions` rows from it, the interpreter workflow
 * re-validates its input against it (pure data + Zod — sandbox-safe), and the
 * web library renders the launch form from its field descriptors.
 *
 * Templates are code-curated, DB-pinned: the catalog defines what a template
 * IS; `workflow_definitions` rows are the per-org immutable versions runs pin
 * via `definition_id`. There is no template-authoring API in v1 — the canvas
 * (Phase 5) becomes the authoring surface over the same graph_spec model.
 */

export const templateKeySchema = z.enum([
  "blog-post-pipeline",
  "seo-brief",
  "competitor-research",
]);
export type TemplateKey = z.infer<typeof templateKeySchema>;

/**
 * The engine parameter contract (Unit 29) — what the interpreter's dispatch
 * actually consumes. Every v1 content template projects onto it via its
 * catalog `toEngineParams`; the blog template's params are this shape already.
 * `topic` is looser than the blog FORM limit: mappings build instruction
 * strings ("SEO content brief for …: cover …"), not user-typed titles.
 */
export const engineParamsSchema = blogPostPipelineInputSchema.extend({
  topic: z.string().min(1).max(600),
});
export type EngineParams = z.infer<typeof engineParamsSchema>;

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
    /** When true the list may be empty (the form drops `required`). */
    optional: z.boolean().optional(),
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
  /**
   * Projects the template's params onto the engine contract the interpreter
   * dispatches (Unit 29 — "catalog mapping functions"). Takes the raw record
   * and parses with the template's own schema internally, so every caller
   * gets one validated, mapped shape with no casts. Pure — sandbox-safe.
   */
  toEngineParams(params: Record<string, unknown>): EngineParams;
}

/** A linear research → approval → write → publish chain under a template name. */
function contentChainSpec(name: string): GraphSpec {
  return graphSpecSchema.parse({
    specVersion: GRAPH_SPEC_VERSION,
    name,
    nodes: [
      { id: "research", type: "research" },
      { id: "approval", type: "approval" },
      { id: "write", type: "write" },
      { id: "publish", type: "publish" },
    ],
    edges: [
      { from: "research", to: "approval" },
      { from: "approval", to: "write" },
      { from: "write", to: "publish" },
    ],
  });
}

export const seoBriefParamsSchema = z.object({
  targetKeyword: z.string().min(1).max(120),
  secondaryKeywords: z.array(z.string().min(1)).max(10).default([]),
  audience: z.string().min(1).max(160),
  approverId: z.string().min(1),
});
export type SeoBriefParams = z.infer<typeof seoBriefParamsSchema>;

export const competitorResearchParamsSchema = z.object({
  company: z.string().min(1).max(120),
  competitors: z.array(z.string().min(1)).min(1).max(8),
  focusAreas: z.array(z.string().min(1)).max(8).default([]),
  approverId: z.string().min(1),
});
export type CompetitorResearchParams = z.infer<typeof competitorResearchParamsSchema>;

export const seoBriefSpec = contentChainSpec("SEO Brief");
export const competitorResearchSpec = contentChainSpec("Competitor Research");

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
    // Blog params ARE the engine contract — identity (re-parse keeps the
    // single no-cast rule for every entry).
    toEngineParams: (params) => blogPostPipelineInputSchema.parse(params),
  },
  "seo-brief": {
    key: "seo-brief",
    name: seoBriefSpec.name,
    description:
      "Keyword landscape research, a reviewer-approved direction, then a complete SEO content brief: search intent, structure, headings, and on-page guidance.",
    spec: seoBriefSpec,
    paramsSchema: seoBriefParamsSchema,
    fields: [
      {
        kind: "text",
        name: "targetKeyword",
        label: "Target keyword",
        placeholder: "ai workflow automation",
        maxLength: 120,
      },
      {
        kind: "csv",
        name: "secondaryKeywords",
        label: "Secondary keywords",
        placeholder: "durable ai pipelines, ai ops platform",
        hint: "Comma-separated, up to 10. Optional.",
        maxItems: 10,
        optional: true,
      },
      {
        kind: "text",
        name: "audience",
        label: "Audience",
        placeholder: "Heads of content at B2B SaaS agencies",
        maxLength: 160,
      },
      { kind: "approver", name: "approverId", label: "Who approves" },
    ],
    toEngineParams: (params) => {
      const p = seoBriefParamsSchema.parse(params);
      return engineParamsSchema.parse({
        topic:
          `SEO content brief for the target keyword "${p.targetKeyword}", written for ${p.audience}. ` +
          "Cover search intent, recommended title and heading structure, questions to answer, " +
          "internal linking ideas, and on-page SEO guidance.",
        keywords: [p.targetKeyword, ...p.secondaryKeywords],
        tone: "professional",
        wordCount: 800,
        approverId: p.approverId,
      });
    },
  },
  "competitor-research": {
    key: "competitor-research",
    name: competitorResearchSpec.name,
    description:
      "Researches your competitors, pauses for your reviewer, then delivers a structured comparison report: positioning, pricing, messaging, strengths and gaps.",
    spec: competitorResearchSpec,
    paramsSchema: competitorResearchParamsSchema,
    fields: [
      {
        kind: "text",
        name: "company",
        label: "Your company",
        placeholder: "Conductor",
        maxLength: 120,
      },
      {
        kind: "csv",
        name: "competitors",
        label: "Competitors",
        placeholder: "Zapier, Make, n8n",
        hint: "Comma-separated, up to 8.",
        maxItems: 8,
      },
      {
        kind: "csv",
        name: "focusAreas",
        label: "Focus areas",
        placeholder: "pricing, positioning, integrations",
        hint: "Comma-separated, up to 8. Optional — defaults to positioning, pricing, messaging.",
        maxItems: 8,
        optional: true,
      },
      { kind: "approver", name: "approverId", label: "Who approves" },
    ],
    toEngineParams: (params) => {
      const p = competitorResearchParamsSchema.parse(params);
      const focus =
        p.focusAreas.length > 0
          ? p.focusAreas.join(", ")
          : "positioning, pricing, messaging, strengths and weaknesses";
      return engineParamsSchema.parse({
        topic:
          `Competitor research report for ${p.company}, analyzing ${p.competitors.join(", ")}. ` +
          `Focus areas: ${focus}. Structure it as a comparison with a clear summary and recommendations.`,
        keywords: [p.company, ...p.competitors],
        tone: "authoritative",
        wordCount: 1200,
        approverId: p.approverId,
      });
    },
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
