import { z } from "zod";
import { ApplicationFailure } from "@temporalio/activity";
import {
  blogToneSchema,
  researchFindingsSchema,
  blogDraftSchema,
  type ResearchFindings,
  type BlogDraft,
} from "@conductor/shared";
import { env } from "../env";
import { logger } from "../logger";
import { createOpenRouterResearchLLM, runResearch } from "./agents/research";

/**
 * Phase 1 stub activities for the content pipeline. Each is a single
 * Zod-validated input object → Zod-validated output (code-standards Temporal)
 * and idempotent (architecture invariant 2): pure functions of their input
 * with no external writes. Units 05–06 replace research/write/publish with
 * LangGraph agents; Unit 14 replaces requestApproval with the Postgres
 * createApprovalRequest.
 */

export const researchInputSchema = z.object({
  topic: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  tone: blogToneSchema,
});
export type ResearchInput = z.infer<typeof researchInputSchema>;

export async function research(input: ResearchInput): Promise<ResearchFindings> {
  // Invalid input is a permanent error — never burn retries on it (invariant 2,
  // code-standards error taxonomy).
  const parsed = researchInputSchema.safeParse(input);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      `Invalid research input: ${parsed.error.message}`,
      "InvalidResearchInput",
    );
  }
  const { topic, keywords, tone } = parsed.data;

  // Phase 1: single platform key from env. Phase 2 (Unit 12) swaps to the org's
  // decrypted OpenRouter key. A missing key is a config error, not transient.
  if (!env.OPENROUTER_API_KEY) {
    throw ApplicationFailure.nonRetryable(
      "OPENROUTER_API_KEY is not set; the research agent cannot run.",
      "MissingOpenRouterKey",
    );
  }

  logger.info(
    { activity: "research", topic, model: env.RESEARCH_MODEL },
    "research agent running",
  );
  const llm = createOpenRouterResearchLLM({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.RESEARCH_MODEL,
  });
  return runResearch({ topic, keywords, tone }, llm);
}

export const requestApprovalInputSchema = z.object({
  approverId: z.string().min(1),
  summary: z.string().min(1),
});
export type RequestApprovalInput = z.infer<typeof requestApprovalInputSchema>;

export const requestApprovalOutputSchema = z.object({
  requested: z.literal(true),
});
export type RequestApprovalOutput = z.infer<typeof requestApprovalOutputSchema>;

export async function requestApproval(
  input: RequestApprovalInput,
): Promise<RequestApprovalOutput> {
  const { approverId } = requestApprovalInputSchema.parse(input);
  logger.info({ activity: "requestApproval", approverId }, "approval requested (stub)");
  return { requested: true };
}

export const writeDraftInputSchema = z.object({
  topic: z.string().min(1),
  findings: researchFindingsSchema,
  tone: blogToneSchema,
  wordCount: z.number().int().positive(),
});
export type WriteDraftInput = z.infer<typeof writeDraftInputSchema>;

export async function writeDraft(input: WriteDraftInput): Promise<BlogDraft> {
  const { topic, findings, tone, wordCount } = writeDraftInputSchema.parse(input);
  logger.info({ activity: "writeDraft", topic }, "write stub running");
  const body = findings.keyPoints.map((point) => `- ${point}`).join("\n");
  return blogDraftSchema.parse({
    title: `Stub draft: ${topic}`,
    markdown: `# ${topic}\n\nWritten in a ${tone} tone (target ${wordCount} words).\n\n${body}\n`,
    wordCount,
  });
}

export const publishInputSchema = z.object({
  draft: blogDraftSchema,
});
export type PublishInput = z.infer<typeof publishInputSchema>;

export const publishOutputSchema = z.object({
  publishedUrl: z.url().optional(),
  deliveredAt: z.iso.datetime(),
});
export type PublishOutput = z.infer<typeof publishOutputSchema>;

export async function publish(input: PublishInput): Promise<PublishOutput> {
  const { draft } = publishInputSchema.parse(input);
  logger.info({ activity: "publish", title: draft.title }, "publish stub running");
  // The clock lives in the activity — never in the workflow (invariant 1).
  return publishOutputSchema.parse({ deliveredAt: new Date().toISOString() });
}
