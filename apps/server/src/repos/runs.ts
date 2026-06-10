import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { workflowRuns } from "../db/schema";

/**
 * Org-scoped helpers for the `workflow_runs` projection. Every function takes
 * the org id from the verified session (never a request body — invariant 11);
 * `findRunById` filters on `(org_id, id)` so a cross-org id resolves to
 * `undefined` → 404 at the route layer.
 */
export type Run = typeof workflowRuns.$inferSelect;
export type NewRun = typeof workflowRuns.$inferInsert;

export async function createRun(values: NewRun): Promise<Run> {
  const rows = await db.insert(workflowRuns).values(values).returning();
  return rows[0]!;
}

export async function findRunById(args: {
  orgId: string;
  id: string;
}): Promise<Run | undefined> {
  const rows = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.orgId, args.orgId), eq(workflowRuns.id, args.id)))
    .limit(1);
  return rows[0];
}

export async function listRuns(args: { orgId: string }): Promise<Run[]> {
  return db
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.orgId, args.orgId))
    .orderBy(desc(workflowRuns.createdAt));
}
