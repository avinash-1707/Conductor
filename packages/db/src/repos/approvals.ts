import { and, desc, eq, lt, or } from "drizzle-orm";
import type { ApprovalContext, ApprovalDecision } from "@conductor/shared";
import type { Db } from "../client";
import { approvalRequests } from "../schema";

/**
 * Org-scoped helpers for `approval_requests` (Unit 14). One gate per run
 * (unique `run_id`): `upsertApprovalForRun` is insert-or-return-existing so a
 * retried createApprovalRequest never resets a decided row; `claimDecision`
 * is the atomic `WHERE status='pending'` guard against concurrent reviewers.
 */
export type Approval = typeof approvalRequests.$inferSelect;
export type NewApproval = typeof approvalRequests.$inferInsert;

/** Keyset cursor for approval lists — strictly descending `(created_at, id)`. */
export interface ApprovalCursor {
  createdAt: Date;
  id: string;
}

export function createApprovalsRepo(db: Db) {
  return {
    async createApproval(values: NewApproval): Promise<Approval> {
      const rows = await db.insert(approvalRequests).values(values).returning();
      return rows[0]!;
    },

    async findApprovalById(args: {
      orgId: string;
      id: string;
    }): Promise<Approval | undefined> {
      const rows = await db
        .select()
        .from(approvalRequests)
        .where(
          and(eq(approvalRequests.orgId, args.orgId), eq(approvalRequests.id, args.id)),
        )
        .limit(1);
      return rows[0];
    },

    async findApprovalByRunId(args: {
      orgId: string;
      runId: string;
    }): Promise<Approval | undefined> {
      const rows = await db
        .select()
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.orgId, args.orgId),
            eq(approvalRequests.runId, args.runId),
          ),
        )
        .limit(1);
      return rows[0];
    },

    /**
     * Idempotent gate creation: inserts the pending request, or returns the
     * existing row untouched (a retry after a reviewer decided must never
     * reset the decision).
     */
    async upsertApprovalForRun(args: {
      orgId: string;
      runId: string;
      context: ApprovalContext;
    }): Promise<Approval> {
      const inserted = await db
        .insert(approvalRequests)
        .values({ orgId: args.orgId, runId: args.runId, context: args.context })
        .onConflictDoNothing({ target: approvalRequests.runId })
        .returning();
      if (inserted[0]) return inserted[0];
      const existing = await this.findApprovalByRunId(args);
      if (!existing) {
        throw new Error("approval request row vanished after conflict");
      }
      return existing;
    },

    /**
     * Atomically records a reviewer decision — only while still pending. An
     * empty return means the gate was already decided/closed (route → 409).
     */
    async claimDecision(args: {
      orgId: string;
      id: string;
      decision: ApprovalDecision;
      reviewerId: string;
      decidedAt: Date;
    }): Promise<Approval | undefined> {
      const rows = await db
        .update(approvalRequests)
        .set({
          status: args.decision,
          reviewerId: args.reviewerId,
          decidedAt: args.decidedAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(approvalRequests.orgId, args.orgId),
            eq(approvalRequests.id, args.id),
            eq(approvalRequests.status, "pending"),
          ),
        )
        .returning();
      return rows[0];
    },

    /**
     * Closes a still-pending gate when the run ends without a recorded
     * decision (expiry, or a decision whose recording was lost). No-op when
     * the row is already decided. `decided_at` stays null — nobody decided.
     */
    async closePendingForRun(args: {
      orgId: string;
      runId: string;
      status: Extract<Approval["status"], "expired" | "rejected">;
    }): Promise<Approval | undefined> {
      const rows = await db
        .update(approvalRequests)
        .set({ status: args.status, updatedAt: new Date() })
        .where(
          and(
            eq(approvalRequests.orgId, args.orgId),
            eq(approvalRequests.runId, args.runId),
            eq(approvalRequests.status, "pending"),
          ),
        )
        .returning();
      return rows[0];
    },

    /** Newest-first keyset pagination over the org's pending queue. */
    async listPendingApprovals(args: {
      orgId: string;
      limit: number;
      cursor?: ApprovalCursor;
    }): Promise<{ items: Approval[]; nextCursor: ApprovalCursor | undefined }> {
      const after = args.cursor
        ? or(
            lt(approvalRequests.createdAt, args.cursor.createdAt),
            and(
              eq(approvalRequests.createdAt, args.cursor.createdAt),
              lt(approvalRequests.id, args.cursor.id),
            ),
          )
        : undefined;
      const rows = await db
        .select()
        .from(approvalRequests)
        .where(
          and(
            eq(approvalRequests.orgId, args.orgId),
            eq(approvalRequests.status, "pending"),
            after,
          ),
        )
        .orderBy(desc(approvalRequests.createdAt), desc(approvalRequests.id))
        .limit(args.limit + 1);
      const items = rows.slice(0, args.limit);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor:
          rows.length > args.limit && last
            ? { createdAt: last.createdAt, id: last.id }
            : undefined,
      };
    },
  };
}

export type ApprovalsRepo = ReturnType<typeof createApprovalsRepo>;
