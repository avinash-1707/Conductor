import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { RunStatus } from "@conductor/shared";
import type { Db } from "../client";
import { workflowRuns } from "../schema";

/**
 * Org-scoped helpers for the `workflow_runs` projection. Every function takes
 * the org id from the verified session (never a request body — invariant 11);
 * `findRunById` filters on `(org_id, id)` so a cross-org id resolves to
 * `undefined` → 404 at the route layer. The worker keys its writes on the
 * unique `temporal_workflow_id` (the only identifier a workflow knows).
 */
export type Run = typeof workflowRuns.$inferSelect;
export type NewRun = typeof workflowRuns.$inferInsert;

/** Keyset cursor for run lists — strictly descending `(created_at, id)`. */
export interface RunCursor {
  createdAt: Date;
  id: string;
}

export function createRunsRepo(db: Db) {
  return {
    async createRun(values: NewRun): Promise<Run> {
      const rows = await db.insert(workflowRuns).values(values).returning();
      return rows[0]!;
    },

    async findRunById(args: { orgId: string; id: string }): Promise<Run | undefined> {
      const rows = await db
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.orgId, args.orgId), eq(workflowRuns.id, args.id)))
        .limit(1);
      return rows[0];
    },

    async findRunByTemporalId(args: {
      orgId: string;
      temporalWorkflowId: string;
    }): Promise<Run | undefined> {
      const rows = await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.orgId, args.orgId),
            eq(workflowRuns.temporalWorkflowId, args.temporalWorkflowId),
          ),
        )
        .limit(1);
      return rows[0];
    },

    /**
     * Newest-first keyset pagination over `(created_at, id)` (the org-scoped
     * index). Returns `limit + 1` peeked rows trimmed to `limit`, plus the
     * cursor for the next page when one exists.
     */
    async listRuns(args: {
      orgId: string;
      limit: number;
      cursor?: RunCursor;
    }): Promise<{ items: Run[]; nextCursor: RunCursor | undefined }> {
      const after = args.cursor
        ? or(
            lt(workflowRuns.createdAt, args.cursor.createdAt),
            and(
              eq(workflowRuns.createdAt, args.cursor.createdAt),
              lt(workflowRuns.id, args.cursor.id),
            ),
          )
        : undefined;
      const rows = await db
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.orgId, args.orgId), after))
        .orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
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

    /**
     * Worker-side run anchor: upserts the projection row keyed by the unique
     * `temporal_workflow_id`. Converges with the server-created `pending` row
     * (Unit 13) and is idempotent across activity retries — `started_at` is
     * preserved once set.
     */
    async ensureRunStarted(args: {
      orgId: string;
      temporalWorkflowId: string;
      temporalRunId: string;
      workflowName: string;
      input: NewRun["input"];
    }): Promise<Run> {
      const rows = await db
        .insert(workflowRuns)
        .values({
          orgId: args.orgId,
          temporalWorkflowId: args.temporalWorkflowId,
          temporalRunId: args.temporalRunId,
          workflowName: args.workflowName,
          input: args.input,
          status: "running",
          startedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: workflowRuns.temporalWorkflowId,
          set: {
            status: "running",
            temporalRunId: args.temporalRunId,
            startedAt: sql`coalesce(${workflowRuns.startedAt}, now())`,
            updatedAt: new Date(),
          },
        })
        .returning();
      return rows[0]!;
    },

    /** Non-terminal status flips (running on step start, suspended at the gate). */
    async markRunStatus(args: {
      orgId: string;
      temporalWorkflowId: string;
      status: RunStatus;
    }): Promise<Run | undefined> {
      const rows = await db
        .update(workflowRuns)
        .set({ status: args.status, updatedAt: new Date() })
        .where(
          and(
            eq(workflowRuns.orgId, args.orgId),
            eq(workflowRuns.temporalWorkflowId, args.temporalWorkflowId),
          ),
        )
        .returning();
      return rows[0];
    },

    /**
     * Terminal projection write (completed / failed / rejected / expired).
     * Idempotent: `completed_at` is preserved across retries.
     */
    async markRunTerminal(args: {
      orgId: string;
      temporalWorkflowId: string;
      status: Extract<RunStatus, "completed" | "failed" | "rejected" | "expired">;
      output?: NewRun["output"];
      error?: string;
    }): Promise<Run | undefined> {
      const rows = await db
        .update(workflowRuns)
        .set({
          status: args.status,
          output: args.output ?? null,
          error: args.error ?? null,
          completedAt: sql`coalesce(${workflowRuns.completedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workflowRuns.orgId, args.orgId),
            eq(workflowRuns.temporalWorkflowId, args.temporalWorkflowId),
          ),
        )
        .returning();
      return rows[0];
    },
  };
}

export type RunsRepo = ReturnType<typeof createRunsRepo>;
