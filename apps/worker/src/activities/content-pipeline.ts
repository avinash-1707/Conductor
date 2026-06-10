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
import { createOpenRouterWritingLLM, runWriting } from "./agents/writing";

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
  keywords: z.array(z.string().min(1)).min(1),
  findings: researchFindingsSchema,
  tone: blogToneSchema,
  wordCount: z.number().int().positive(),
});
export type WriteDraftInput = z.infer<typeof writeDraftInputSchema>;

export async function writeDraft(input: WriteDraftInput): Promise<BlogDraft> {
  const parsed = writeDraftInputSchema.safeParse(input);
  if (!parsed.success) {
    throw ApplicationFailure.nonRetryable(
      `Invalid write input: ${parsed.error.message}`,
      "InvalidWriteInput",
    );
  }
  const { topic, keywords, findings, tone, wordCount } = parsed.data;

  if (!env.OPENROUTER_API_KEY) {
    throw ApplicationFailure.nonRetryable(
      "OPENROUTER_API_KEY is not set; the writing agent cannot run.",
      "MissingOpenRouterKey",
    );
  }

  logger.info(
    { activity: "writeDraft", topic, model: env.WRITING_MODEL },
    "writing agent running",
  );
  const llm = createOpenRouterWritingLLM({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.WRITING_MODEL,
  });
  return runWriting({ topic, keywords, tone, wordCount, findings }, llm);
}

export const publishInputSchema = z.object({
  draft: blogDraftSchema,
  // Run-scoped idempotency key (the workflow id). Temporal retries reuse it, so
  // a re-run of this activity delivers exactly once (architecture invariant 2).
  idempotencyKey: z.string().min(1),
});
export type PublishInput = z.infer<typeof publishInputSchema>;

export const publishOutputSchema = z.object({
  publishedUrl: z.url().optional(),
  deliveredAt: z.iso.datetime(),
});
export type PublishOutput = z.infer<typeof publishOutputSchema>;

/**
 * In-memory delivery ledger (Phase 1 stub). The DB-backed, cross-process
 * idempotency store arrives with projections (Unit 12); until then this dedupes
 * within a worker process, which is enough to prove the contract and survive
 * activity retries on the same worker.
 */
const deliveries = new Map<string, PublishOutput>();

/** Test-only: clears the in-memory delivery ledger between cases. */
export function _resetPublishState(): void {
  deliveries.clear();
}

export async function publish(input: PublishInput): Promise<PublishOutput> {
  const { draft, idempotencyKey } = publishInputSchema.parse(input);

  const existing = deliveries.get(idempotencyKey);
  if (existing) {
    logger.info(
      { activity: "publish", idempotencyKey, title: draft.title },
      "publish skipped — already delivered (idempotent)",
    );
    return existing;
  }

  // The clock lives in the activity — never in the workflow (invariant 1).
  const receipt: PublishOutput = publishOutputSchema.parse({
    deliveredAt: new Date().toISOString(),
    ...(env.PUBLISH_WEBHOOK_URL ? { publishedUrl: env.PUBLISH_WEBHOOK_URL } : {}),
  });

  if (env.PUBLISH_WEBHOOK_URL) {
    const res = await fetch(env.PUBLISH_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(draft),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      // Transient/5xx: throw normally so Temporal retries; the ledger is only
      // written on success, so a retry re-delivers (no false "already delivered").
      throw new Error(`Publish webhook returned ${res.status}`);
    }
  } else {
    logger.info(
      { activity: "publish", idempotencyKey, title: draft.title },
      "publish stub — simulated delivery (no PUBLISH_WEBHOOK_URL set)",
    );
  }

  deliveries.set(idempotencyKey, receipt);
  return receipt;
}
