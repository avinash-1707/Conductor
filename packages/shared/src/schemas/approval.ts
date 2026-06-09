import { z } from "zod";

/** The two terminal decisions a reviewer can make on an approval gate. */
export const approvalDecisionSchema = z.enum(["approved", "rejected"]);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

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
