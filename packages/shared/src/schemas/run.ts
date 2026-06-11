import { z } from "zod";

import { runStatusSchema, stepKindSchema, stepStatusSchema } from "./status";
import { blogPostPipelineOutputSchema } from "./blog-pipeline";

/**
 * Run-API resource contracts (Unit 13). The server serializes projection rows
 * into these shapes (Dates → ISO strings, `org_id` never echoed — the caller's
 * org is implicit from the verified JWT); the web client parses every response
 * against them (architecture invariant 5).
 */

export const runSchema = z.object({
  id: z.uuid(),
  workflowName: z.string().min(1),
  temporalWorkflowId: z.string().min(1),
  temporalRunId: z.string().min(1).nullable(),
  status: runStatusSchema,
  /** Template-shaped launch params (Unit 26) — render via the template's own schema. */
  input: z.record(z.string(), z.unknown()),
  output: blogPostPipelineOutputSchema.nullable(),
  error: z.string().nullable(),
  /** The run this one was resumed from (Unit 22), if any. */
  resumedFromRunId: z.uuid().nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type RunResource = z.infer<typeof runSchema>;

/** A projection step row on the Run Detail timeline (one per step kind). */
export const runStepSchema = z.object({
  id: z.uuid(),
  stepKind: stepKindSchema,
  status: stepStatusSchema,
  attempt: z.number().int().positive(),
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
});
export type RunStepResource = z.infer<typeof runStepSchema>;

/** `GET /runs` — cursor-paginated, newest first. `nextCursor` is opaque. */
export const runListResponseSchema = z.object({
  items: z.array(runSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type RunListResponse = z.infer<typeof runListResponseSchema>;

/** `GET /runs/:id` — the run plus its step projections. */
export const runDetailResponseSchema = z.object({
  run: runSchema,
  steps: z.array(runStepSchema),
});
export type RunDetailResponse = z.infer<typeof runDetailResponseSchema>;
