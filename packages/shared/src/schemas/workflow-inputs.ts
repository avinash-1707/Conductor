import { z } from "zod";

import { blogPostPipelineInputSchema } from "./blog-pipeline";

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
});
export type ContentPipelineInput = z.infer<typeof contentPipelineInputSchema>;
