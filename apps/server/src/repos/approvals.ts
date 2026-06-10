import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { approvalRequests } from "../db/schema";

/**
 * Org-scoped helpers for `approval_requests`. The decision-recording mutation
 * and the Temporal signal that resumes the run land in Unit 14; this unit
 * provides creation, scoped lookup, and the pending-queue list.
 */
export type Approval = typeof approvalRequests.$inferSelect;
export type NewApproval = typeof approvalRequests.$inferInsert;

export async function createApproval(values: NewApproval): Promise<Approval> {
  const rows = await db.insert(approvalRequests).values(values).returning();
  return rows[0]!;
}

export async function findApprovalById(args: {
  orgId: string;
  id: string;
}): Promise<Approval | undefined> {
  const rows = await db
    .select()
    .from(approvalRequests)
    .where(and(eq(approvalRequests.orgId, args.orgId), eq(approvalRequests.id, args.id)))
    .limit(1);
  return rows[0];
}

export async function listPendingApprovals(args: { orgId: string }): Promise<Approval[]> {
  return db
    .select()
    .from(approvalRequests)
    .where(
      and(eq(approvalRequests.orgId, args.orgId), eq(approvalRequests.status, "pending")),
    )
    .orderBy(desc(approvalRequests.createdAt));
}
