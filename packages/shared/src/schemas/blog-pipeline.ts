import { z } from "zod";

import { runStatusSchema } from "./status";

/** Tone options exposed by the Blog Post Pipeline launch form. */
export const blogToneSchema = z.enum([
  "professional",
  "casual",
  "technical",
  "authoritative",
  "playful",
]);
export type BlogTone = z.infer<typeof blogToneSchema>;

/**
 * Launch parameters for the Blog Post Pipeline. The launch form is generated
 * from this schema; the server validates the request body against it and sets
 * `orgId` itself (never from the body — architecture invariant 11), so orgId
 * is intentionally absent here.
 */
export const blogPostPipelineInputSchema = z.object({
  topic: z.string().min(1).max(200),
  keywords: z.array(z.string().min(1)).min(1).max(10),
  tone: blogToneSchema,
  wordCount: z.number().int().min(100).max(5000),
  approverId: z.string().min(1),
});
export type BlogPostPipelineInput = z.infer<typeof blogPostPipelineInputSchema>;

/** Research step output — also the context rendered in the approval card. */
export const researchFindingsSchema = z.object({
  summary: z.string().min(1),
  sources: z
    .array(
      z.object({
        title: z.string().min(1),
        url: z.url(),
        takeaway: z.string().min(1),
      }),
    )
    .min(1),
  keyPoints: z.array(z.string().min(1)).min(1),
});
export type ResearchFindings = z.infer<typeof researchFindingsSchema>;

/** Writing step output. */
export const blogDraftSchema = z.object({
  title: z.string().min(1),
  markdown: z.string().min(1),
  wordCount: z.number().int().positive(),
});
export type BlogDraft = z.infer<typeof blogDraftSchema>;

/** Final pipeline result after publish. */
export const blogPostPipelineOutputSchema = z.object({
  draft: blogDraftSchema,
  publishedUrl: z.url().optional(),
  deliveredAt: z.iso.datetime(),
});
export type BlogPostPipelineOutput = z.infer<typeof blogPostPipelineOutputSchema>;

/**
 * Terminal result of the contentPipeline workflow. Rejection and expiry are
 * graceful outcomes (discriminated union per code-standards), never workflow
 * failures — only exhausted retries or invalid input fail a run.
 */
export const contentPipelineResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    output: blogPostPipelineOutputSchema,
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
export type ContentPipelineResult = z.infer<typeof contentPipelineResultSchema>;

/**
 * Steps the contentPipeline can be in, as reported by the RUN_STATE query.
 * `approval` is the suspended gate, not a step kind (status.ts).
 */
export const pipelineStepSchema = z.enum(["research", "approval", "write", "publish"]);
export type PipelineStep = z.infer<typeof pipelineStepSchema>;

/** Answer shape of the RUN_STATE workflow query (debugging/reconnection). */
export const runStateSchema = z.object({
  status: runStatusSchema,
  currentStep: pipelineStepSchema.nullable(),
});
export type RunState = z.infer<typeof runStateSchema>;
