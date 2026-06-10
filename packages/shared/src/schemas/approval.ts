import { z } from "zod";

import { researchFindingsSchema, blogDraftSchema } from "./blog-pipeline";

/** The two terminal decisions a reviewer can make on an approval gate. */
export const approvalDecisionSchema = z.enum(["approved", "rejected"]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/**
 * Lifecycle status of an `approval_requests` row (domain record / projection).
 * `pending` is the suspended gate; the rest are terminal. Mirrored as the
 * Postgres `approval_status` enum in the server schema.
 */
export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

/**
 * Context payload stored on an approval request and rendered in the Approval
 * Queue card: the research findings always, and the draft once writing has run.
 * The JSONB `context` column on `approval_requests` is typed and parsed against
 * this schema at the boundary (code-standards "Data and Storage").
 */
export const approvalContextSchema = z.object({
  research: researchFindingsSchema,
  draft: blogDraftSchema.optional(),
});
export type ApprovalContext = z.infer<typeof approvalContextSchema>;

/**
 * Body of the `approvalDecision` signal sent from the server to a suspended
 * workflow. The workflow holds this in a local variable and resumes via
 * condition(); no activity ever blocks on it (architecture invariant 3).
 */
export const approvalSignalPayloadSchema = z.object({
  decision: approvalDecisionSchema,
  reviewerId: z.string().min(1),
  decidedAt: z.iso.datetime(),
});
export type ApprovalSignalPayload = z.infer<typeof approvalSignalPayloadSchema>;
