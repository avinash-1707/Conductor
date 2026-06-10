import { and, asc, eq } from "drizzle-orm";
import type { StepKind } from "@conductor/shared";
import type { Db } from "../client";
import { activityLog } from "../schema";

/**
 * Org-scoped helpers for the `activity_log` projection. One logical row per
 * `(run_id, step_kind)`, upserted across Temporal retries — the row reflects
 * the *latest* attempt (attempt count + latest error); per-attempt error
 * history is deferred (Unit 10 decision).
 */
export type Step = typeof activityLog.$inferSelect;
export type NewStep = typeof activityLog.$inferInsert;

export function createActivityLogRepo(db: Db) {
  return {
    async upsertStep(values: NewStep): Promise<Step> {
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
    },

    /**
     * Attempt start: the row flips to `running` with a fresh `started_at` and a
     * cleared error/output/completion — prior-attempt remnants never linger on
     * a row that is executing again.
     */
    async startStepAttempt(args: {
      orgId: string;
      runId: string;
      stepKind: StepKind;
      attempt: number;
      input: unknown;
    }): Promise<Step> {
      const rows = await db
        .insert(activityLog)
        .values({
          orgId: args.orgId,
          runId: args.runId,
          stepKind: args.stepKind,
          status: "running",
          attempt: args.attempt,
          input: args.input,
          startedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [activityLog.runId, activityLog.stepKind],
          set: {
            status: "running",
            attempt: args.attempt,
            input: args.input,
            output: null,
            error: null,
            startedAt: new Date(),
            completedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning();
      return rows[0]!;
    },

    async completeStep(args: {
      orgId: string;
      runId: string;
      stepKind: StepKind;
      output: unknown;
    }): Promise<Step | undefined> {
      const rows = await db
        .update(activityLog)
        .set({
          status: "completed",
          output: args.output,
          error: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(activityLog.orgId, args.orgId),
            eq(activityLog.runId, args.runId),
            eq(activityLog.stepKind, args.stepKind),
          ),
        )
        .returning();
      return rows[0];
    },

    /**
     * Attempt failure. `terminal: false` → `retrying` (Temporal will re-run);
     * `terminal: true` → `failed` (non-retryable error, or the workflow-level
     * reconciliation after retries exhaust).
     */
    async failStepAttempt(args: {
      orgId: string;
      runId: string;
      stepKind: StepKind;
      error: string;
      terminal: boolean;
    }): Promise<Step | undefined> {
      const rows = await db
        .update(activityLog)
        .set({
          status: args.terminal ? "failed" : "retrying",
          error: args.error,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(activityLog.orgId, args.orgId),
            eq(activityLog.runId, args.runId),
            eq(activityLog.stepKind, args.stepKind),
          ),
        )
        .returning();
      return rows[0];
    },

    async listStepsForRun(args: { orgId: string; runId: string }): Promise<Step[]> {
      return db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.orgId, args.orgId), eq(activityLog.runId, args.runId)))
        .orderBy(asc(activityLog.createdAt));
    },
  };
}

export type ActivityLogRepo = ReturnType<typeof createActivityLogRepo>;
