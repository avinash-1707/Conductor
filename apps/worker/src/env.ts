import { z } from "zod";

/**
 * Worker process configuration, parsed once at startup (never inside workflow
 * code — architecture invariant 1). Defaults target the Unit 01 docker-compose
 * Temporal so the worker runs with zero local config.
 */
const envSchema = z.object({
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  // OpenRouter key for agent LLM calls. Optional in Phase 1 (the worker runs on
  // a single platform key); Phase 2 (Unit 12) switches to the per-org key
  // decrypted at activity call time (architecture invariant 12). Activities that
  // need it fail non-retryably when it is absent — never logged.
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  // OpenRouter model slug for the research agent (Unit 05). Writing uses its own
  // (stronger) model in Unit 06.
  RESEARCH_MODEL: z.string().min(1).default("anthropic/claude-sonnet-4.5"),
  // Stronger model for the writing agent (Unit 06).
  WRITING_MODEL: z.string().min(1).default("anthropic/claude-opus-4.8"),
  // Optional publish target. When set, the publish activity POSTs the draft with
  // an Idempotency-Key header; when absent it simulates delivery (Phase 1 stub).
  PUBLISH_WEBHOOK_URL: z.url().optional(),
});

export const env = envSchema.parse(process.env);
