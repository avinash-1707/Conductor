import { z } from "zod";

/**
 * Run-level status. Mirrors the run badge states in ui-context.md and
 * project-overview.md (running / suspended / completed / failed), plus the
 * terminal gate outcomes (rejected, expired) and the lifecycle ends
 * (pending, cancelled).
 */
export const runStatusSchema = z.enum([
  "pending",
  "running",
  "suspended",
  "completed",
  "failed",
  "cancelled",
  "rejected",
  "expired",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

/**
 * Per-step status shown on the Run Detail timeline rail. `retrying` is the
 * orange retry token (a failed attempt with another scheduled).
 */
export const stepStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "retrying",
]);
export type StepStatus = z.infer<typeof stepStatusSchema>;

/**
 * The AI pipeline steps. The human approval gate is modelled as an event
 * (approval.requested) and an approval record, not as a step kind.
 */
export const stepKindSchema = z.enum(["research", "write", "publish"]);
export type StepKind = z.infer<typeof stepKindSchema>;
