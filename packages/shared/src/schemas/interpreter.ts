import { z } from "zod";

import {
  blogDraftSchema,
  blogPostPipelineOutputSchema,
  researchFindingsSchema,
} from "./blog-pipeline";
import { graphSpecSchema } from "./graph-spec";
import { templateCatalog, templateKeySchema } from "./template";

/**
 * Interpreter workflow contract (Unit 25, generalized in Unit 26) — the single
 * execution path every template and canvas-authored workflow (Phase 5) runs on.
 *
 * The spec rides inline in the workflow input: the run pins exactly the graph
 * it executes inside Temporal history (the `definition_id` FK records which
 * version row it came from). Parsing this input re-runs the full graph
 * validation AND the per-template parameter validation inside the workflow —
 * pure and deterministic (the catalog is data + Zod).
 */

/**
 * Channel-based resume (Unit 26 — generalizes Unit 22's step-discriminated
 * union without changing its semantics). The server derives this from the
 * failed run's stored `activity_log` outputs — never from a client. Walk rule:
 * an activity node is SKIPPED when its `produces` channel was pre-supplied
 * (a node producing nothing — publish — therefore always executes: a
 * resumed-at-publish run never delivered); the approval gate is skipped only
 * when `gateApproved` (an unapproved gate re-runs with the carried findings).
 */
export const interpreterResumeSchema = z.object({
  channels: z.object({
    research: researchFindingsSchema.optional(),
    draft: blogDraftSchema.optional(),
  }),
  gateApproved: z.boolean(),
});
export type InterpreterResume = z.infer<typeof interpreterResumeSchema>;

/**
 * `params` is template-shaped, not blog-shaped (Unit 26): the superRefine
 * validates it against the template's own parameter schema, so the server
 * boundary and the workflow's input parse enforce one contract — validation
 * IS the schema (Unit 24 principle). `orgId` is set by the server from the
 * verified JWT claims, never from a request body (invariant 11).
 */
export const interpreterInputSchema = z
  .object({
    orgId: z.string().min(1),
    templateKey: templateKeySchema,
    spec: graphSpecSchema,
    params: z.record(z.string(), z.unknown()),
    resumeFrom: interpreterResumeSchema.optional(),
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
export type InterpreterInput = z.infer<typeof interpreterInputSchema>;

/**
 * Terminal result — rejection/expiry are graceful outcomes, never failures.
 * `output` is optional on `completed`: present when the chain produced the
 * deliverable (publish receipt + draft); absent for degenerate-but-valid
 * chains (e.g. research-only). Stays blog-typed in v1 — every v1 template
 * ends in publish (Unit 29 open question records the wider need).
 */
export const interpreterResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    output: blogPostPipelineOutputSchema.optional(),
  }),
  z.object({
    status: z.literal("rejected"),
    reviewerId: z.string().min(1),
    decidedAt: z.iso.datetime(),
  }),
  z.object({
    status: z.literal("expired"),
  }),
]);
export type InterpreterResult = z.infer<typeof interpreterResultSchema>;
