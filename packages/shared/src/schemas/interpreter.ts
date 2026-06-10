import { z } from "zod";

import { blogPostPipelineInputSchema, blogPostPipelineOutputSchema } from "./blog-pipeline";
import { graphSpecSchema } from "./graph-spec";

/**
 * Interpreter workflow contract (Unit 25) — the single execution path every
 * template (Unit 26) and canvas-authored workflow (Phase 5) runs on.
 *
 * The spec rides inline in the workflow input: the run pins exactly the graph
 * it executes inside Temporal history (the `definition_id` FK records which
 * version row it came from, Unit 26). Parsing this input re-runs the full
 * graph validation inside the workflow — pure and deterministic.
 *
 * v1 decision (spec 25): the walking/dispatch machinery is generic, but
 * `params` stays the one curated parameter shape v1 has. Unit 26 introduces
 * per-template parameter schemas and generalizes this.
 */
export const interpreterInputSchema = z.object({
  orgId: z.string().min(1),
  spec: graphSpecSchema,
  params: blogPostPipelineInputSchema,
});
export type InterpreterInput = z.infer<typeof interpreterInputSchema>;

/**
 * Terminal result — mirrors contentPipelineResultSchema (rejection/expiry are
 * graceful outcomes, never failures). `output` is optional on `completed`:
 * present when the chain produced the deliverable (publish receipt + draft);
 * absent for degenerate-but-valid chains (e.g. research-only).
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
