import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { activityLog } from "../db/schema";

/**
 * Org-scoped helpers for the `activity_log` projection. One logical row per
 * `(run_id, step_kind)`, upserted across Temporal retries (idempotent — Unit 12
 * increments `attempt` / overwrites the latest `error` rather than inserting per
 * attempt).
 */
export type Step = typeof activityLog.$inferSelect;
export type NewStep = typeof activityLog.$inferInsert;

export async function upsertStep(values: NewStep): Promise<Step> {
  const rows = await db
    .insert(activityLog)
    .values(values)
    .onConflictDoUpdate({
      target: [activityLog.runId, activityLog.stepKind],
      set: {
        status: values.status,
        attempt: values.attempt,
        input: values.input,
        output: values.output,
        error: values.error,
        startedAt: values.startedAt,
        completedAt: values.completedAt,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0]!;
}

export async function listStepsForRun(args: {
  orgId: string;
  runId: string;
}): Promise<Step[]> {
  return db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.orgId, args.orgId), eq(activityLog.runId, args.runId)))
    .orderBy(asc(activityLog.createdAt));
}
