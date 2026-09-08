import { z } from "zod";

import { modelTierSchema } from "./models";

/** Durable metadata for one provider call inside a tracked agent step. */
export const llmCallObservationSchema = z.object({
  operation: z.string().min(1).max(80),
  model: z.string().min(1).max(128),
  tier: modelTierSchema,
  promptVersion: z.string().min(1).max(80),
  latencyMs: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  repaired: z.boolean(),
});
export type LlmCallObservation = z.infer<typeof llmCallObservationSchema>;
