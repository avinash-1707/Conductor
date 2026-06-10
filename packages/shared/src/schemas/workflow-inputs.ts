import { z } from "zod";

import {
  blogDraftSchema,
  blogPostPipelineInputSchema,
  researchFindingsSchema,
} from "./blog-pipeline";

/**
 * Resume-from-step (Unit 22): the server derives this from the failed run's
 * stored `activity_log` outputs — never from the client — and the workflow
 * skips every supplied step (Conductor's feature, not Temporal replay). The
 * step names the first phase that EXECUTES; there is no `research` variant
 * because a run with nothing usable simply restarts without `resumeFrom`.
 * The gate is skipped only when the prior run's gate was approved (the
 * `approval` variant re-runs it with the carried findings).
 */
export const resumeFromSchema = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("approval"),
    priorOutputs: z.object({ research: researchFindingsSchema }),
  }),
  z.object({
    step: z.literal("write"),
    priorOutputs: z.object({ research: researchFindingsSchema }),
  }),
  z.object({
    step: z.literal("publish"),
    priorOutputs: z.object({
      research: researchFindingsSchema,
      write: blogDraftSchema,
    }),
  }),
]);
export type ResumeFrom = z.infer<typeof resumeFromSchema>;

/**
 * Inputs the server passes to `client.workflow.start(...)` — the launch
 * parameters plus the execution context the worker needs. `orgId` is set by
 * the server from the verified JWT claims, never from a request body
 * (architecture invariant 11); the worker trusts it (the server already
 * authorized the start) and uses it to scope every projection write and the
 * org API-key lookup.
 */
export const contentPipelineInputSchema = blogPostPipelineInputSchema.extend({
  orgId: z.string().min(1),
  resumeFrom: resumeFromSchema.optional(),
});
export type ContentPipelineInput = z.infer<typeof contentPipelineInputSchema>;
