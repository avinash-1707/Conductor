import { z } from "zod";

/**
 * Worker process configuration, parsed once at startup (never inside workflow
 * code — architecture invariant 1). Defaults target the Unit 01 docker-compose
 * Temporal so the worker runs with zero local config.
 */
const envSchema = z.object({
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
});

export const env = envSchema.parse(process.env);
