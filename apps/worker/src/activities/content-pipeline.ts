import { z } from "zod";
import {
  blogToneSchema,
  researchFindingsSchema,
  blogDraftSchema,
  publishReceiptSchema,
  type ResearchFindings,
  type BlogDraft,
  type PublishReceipt,
} from "@conductor/shared";
import { env } from "../env";
import { repos } from "../db";
import { logger } from "../logger";
import { createOpenRouterResearchLLM, runResearch } from "./agents/research";
import { createOpenRouterWritingLLM, runWriting } from "./agents/writing";
import { withStepTracking } from "./with-step-tracking";
import { resolveOrgApiKey } from "./org-keys";

/**
 * Content-pipeline step activities. Each is a single Zod-validated input
 * object → Zod-validated output (code-standards Temporal), idempotent
 * (architecture invariant 2), wrapped in `withStepTracking` so every attempt
 * lands in the `activity_log` / `workflow_runs` projections (Unit 12), and
 * runs on the org's decrypted OpenRouter key (invariant 12). Unit 14 replaces
 * requestApproval with the Postgres createApprovalRequest.
 */

export const researchInputSchema = z.object({
  orgId: z.string().min(1),
  topic: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  tone: blogToneSchema,
});
export type ResearchInput = z.infer<typeof researchInputSchema>;

export const research = withStepTracking(
  "research",
  researchInputSchema,
  async (input: ResearchInput): Promise<ResearchFindings> => {
    const { orgId, topic, keywords, tone } = input;
    const apiKey = await resolveOrgApiKey(orgId);

    logger.info(
      { activity: "research", orgId, topic, model: env.RESEARCH_MODEL },
      "research agent running",
    );
    const llm = createOpenRouterResearchLLM({ apiKey, model: env.RESEARCH_MODEL });
    return runResearch({ topic, keywords, tone }, llm);
  },
);

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
  orgId: z.string().min(1),
  topic: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  findings: researchFindingsSchema,
  tone: blogToneSchema,
  wordCount: z.number().int().positive(),
});
export type WriteDraftInput = z.infer<typeof writeDraftInputSchema>;

export const writeDraft = withStepTracking(
  "write",
  writeDraftInputSchema,
  async (input: WriteDraftInput): Promise<BlogDraft> => {
    const { orgId, topic, keywords, findings, tone, wordCount } = input;
    const apiKey = await resolveOrgApiKey(orgId);

    logger.info(
      { activity: "writeDraft", orgId, topic, model: env.WRITING_MODEL },
      "writing agent running",
    );
    const llm = createOpenRouterWritingLLM({ apiKey, model: env.WRITING_MODEL });
    return runWriting({ topic, keywords, tone, wordCount, findings }, llm);
  },
);

export const publishInputSchema = z.object({
  orgId: z.string().min(1),
  draft: blogDraftSchema,
  // Run-scoped idempotency key (the workflow id). Temporal retries reuse it, so
  // a re-run of this activity delivers exactly once (architecture invariant 2).
  idempotencyKey: z.string().min(1),
});
export type PublishInput = z.infer<typeof publishInputSchema>;

export const publishOutputSchema = publishReceiptSchema;
export type PublishOutput = PublishReceipt;

export const publish = withStepTracking(
  "publish",
  publishInputSchema,
  async (input: PublishInput): Promise<PublishOutput> => {
    const { orgId, draft, idempotencyKey } = input;

    // The Postgres-backed delivery ledger (Unit 12): a repeat key returns the
    // original receipt — exactly-once across retries, restarts, and workers.
    const existing = await repos.publishDeliveries.findDelivery({
      orgId,
      idempotencyKey,
    });
    if (existing) {
      logger.info(
        { activity: "publish", orgId, idempotencyKey, title: draft.title },
        "publish skipped — already delivered (idempotent)",
      );
      return publishReceiptSchema.parse(existing.receipt);
    }

    // The clock lives in the activity — never in the workflow (invariant 1).
    const receipt: PublishReceipt = publishReceiptSchema.parse({
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
        { activity: "publish", orgId, idempotencyKey, title: draft.title },
        "publish stub — simulated delivery (no PUBLISH_WEBHOOK_URL set)",
      );
    }

    const stored = await repos.publishDeliveries.recordDelivery({
      orgId,
      idempotencyKey,
      receipt,
    });
    // A racing worker may have won the insert — its receipt is authoritative.
    return publishReceiptSchema.parse(stored.receipt);
  },
);
