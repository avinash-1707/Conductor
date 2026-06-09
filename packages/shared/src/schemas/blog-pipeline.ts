import { z } from "zod";

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
