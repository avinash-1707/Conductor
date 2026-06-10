import { relations } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  text,
  integer,
  jsonb,
  uuid,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  BlogPostPipelineInput,
  BlogPostPipelineOutput,
  ApprovalContext,
} from "@conductor/shared";
import { organization } from "./auth";

/**
 * Conductor domain tables (Unit 10) — migration #2. Every table carries a
 * non-null `org_id` referencing `organization(id)` and is reached only through
 * the org-scoped helpers in `repos/` (architecture invariant 11). `workflow_runs`
 * and `activity_log` are read-side projections (storage model); the rest are
 * domain records.
 *
 * Enum value tuples are inlined here (so drizzle-kit's esbuild loader needs no
 * workspace-package resolution) but must stay in lockstep with the shared Zod
 * enums — `domain.enum.test.ts` asserts equality.
 */

// run_status — mirrors @conductor/shared runStatusSchema.options
export const runStatusEnum = pgEnum("run_status", [
  "pending",
  "running",
  "suspended",
  "completed",
  "failed",
  "cancelled",
  "rejected",
  "expired",
]);

// step_status — mirrors @conductor/shared stepStatusSchema.options
export const stepStatusEnum = pgEnum("step_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "retrying",
]);

// step_kind — mirrors @conductor/shared stepKindSchema.options
export const stepKindEnum = pgEnum("step_kind", ["research", "write", "publish"]);

// approval_status — mirrors @conductor/shared approvalStatusSchema.options
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
]);

const orgId = () =>
  text("org_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull();

/** Curated pipeline template; later the canvas graph_spec (Unit 24). */
export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    version: integer("version").default(1).notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("workflow_definitions_org_name_version_uidx").on(t.orgId, t.name, t.version),
    index("workflow_definitions_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/** Run projection — mirrors Temporal history for fast dashboard reads. */
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    definitionId: uuid("definition_id").references(() => workflowDefinitions.id, {
      onDelete: "set null",
    }),
    workflowName: text("workflow_name").notNull(),
    temporalWorkflowId: text("temporal_workflow_id").notNull(),
    temporalRunId: text("temporal_run_id"),
    status: runStatusEnum("status").default("pending").notNull(),
    input: jsonb("input").$type<BlogPostPipelineInput>().notNull(),
    output: jsonb("output").$type<BlogPostPipelineOutput>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("workflow_runs_temporal_workflow_id_uidx").on(t.temporalWorkflowId),
    index("workflow_runs_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/** Per-step projection — one row per (run, step_kind), upserted across retries. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepKind: stepKindEnum("step_kind").notNull(),
    status: stepStatusEnum("status").default("pending").notNull(),
    attempt: integer("attempt").default(1).notNull(),
    input: jsonb("input").$type<unknown>(),
    output: jsonb("output").$type<unknown>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("activity_log_run_step_uidx").on(t.runId, t.stepKind),
    index("activity_log_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/** Human approval gate record — context rendered in the Approval Queue. */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    runId: uuid("run_id")
      .notNull()
      .references(() => workflowRuns.id, { onDelete: "cascade" }),
    status: approvalStatusEnum("status").default("pending").notNull(),
    context: jsonb("context").$type<ApprovalContext>().notNull(),
    reviewerId: text("reviewer_id"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("approval_requests_org_status_idx").on(t.orgId, t.status),
    index("approval_requests_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/** Per-org OpenRouter key, encrypted at rest (Unit 11). One row per org. */
export const orgApiKeys = pgTable(
  "org_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: orgId(),
    ciphertext: text("ciphertext").notNull(),
    last4: text("last4").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("org_api_keys_org_uidx").on(t.orgId)],
);

export const workflowDefinitionsRelations = relations(workflowDefinitions, ({ many }) => ({
  runs: many(workflowRuns),
}));

export const workflowRunsRelations = relations(workflowRuns, ({ one, many }) => ({
  definition: one(workflowDefinitions, {
    fields: [workflowRuns.definitionId],
    references: [workflowDefinitions.id],
  }),
  steps: many(activityLog),
  approvals: many(approvalRequests),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  run: one(workflowRuns, {
    fields: [activityLog.runId],
    references: [workflowRuns.id],
  }),
}));

export const approvalRequestsRelations = relations(approvalRequests, ({ one }) => ({
  run: one(workflowRuns, {
    fields: [approvalRequests.runId],
    references: [workflowRuns.id],
  }),
}));
