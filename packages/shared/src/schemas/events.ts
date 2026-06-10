import { z } from "zod";
import { runStatusSchema, stepStatusSchema, stepKindSchema } from "./status";

/**
 * Events published to the Redis `run:{id}:status` channel and relayed to
 * WebSocket clients. Discriminated on `type`. `at` is an ISO-8601 UTC string.
 */
export const runEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.status"),
    runId: z.string().min(1),
    status: runStatusSchema,
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("step.status"),
    runId: z.string().min(1),
    step: stepKindSchema,
    status: stepStatusSchema,
    attempt: z.number().int().positive(),
    at: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("approval.requested"),
    runId: z.string().min(1),
    approvalId: z.string().min(1),
    // Lets the server fan this event out to the org-wide room (Unit 23), so
    // the Approval Queue and sidebar badge update live without a run
    // subscription. Org members only — the org room is joined at handshake.
    orgId: z.string().min(1),
    at: z.iso.datetime(),
  }),
]);
export type RunEvent = z.infer<typeof runEventSchema>;

/**
 * LLM token-stream chunks published to the Redis `run:{id}:stream` channel.
 * Only token streams ride this channel — never final results, which enter
 * Temporal payloads instead (architecture invariant 8).
 */
export const tokenStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("token"),
    runId: z.string().min(1),
    step: stepKindSchema,
    delta: z.string(),
  }),
  z.object({
    type: z.literal("done"),
    runId: z.string().min(1),
    step: stepKindSchema,
  }),
]);
export type TokenStreamEvent = z.infer<typeof tokenStreamEventSchema>;
