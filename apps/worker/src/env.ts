import { z } from "zod";
import { TASK_QUEUE } from "@conductor/shared";

/**
 * Worker process configuration, parsed once at startup (never inside workflow
 * code — architecture invariant 1). Defaults target the Unit 01 docker-compose
 * stack so the worker runs with zero local config.
 */
const envSchema = z.object({
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  // Task queue override (Unit 23). Defaults to the shared constant; the
  // golden-path E2E runs worker+server on an isolated queue so a stale dev
  // worker can never steal its activities. Must match the server's value.
  TEMPORAL_TASK_QUEUE: z.string().min(1).default(TASK_QUEUE),
  // Projections + org API keys live in Postgres (Unit 12); same local default
  // as the server.
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://conductor:conductor@localhost:5432/conductor"),
  // Pub/sub for live step/run status events (Unit 17). Ephemeral — a publish
  // failure is logged and swallowed, never fails an activity. Same local default
  // as the server.
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  // AES-256-GCM key (base64, 32 bytes) used to DECRYPT per-org OpenRouter keys
  // at activity call time (invariant 12). Must match the server's key. The
  // default is clearly dev-only; PRODUCTION MUST override (`openssl rand -base64 32`).
  PLATFORM_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .default("ZGV2LW9ubHktaW5zZWN1cmUtcGxhdGZvcm0ta2V5ISE="),
  // OpenRouter model slug for the research agent (Unit 05). Writing uses its own
  // (stronger) model in Unit 06. The API key is the org's, resolved per run —
  // there is no platform OpenRouter key anymore (Unit 12).
  RESEARCH_MODEL: z.string().min(1).default("anthropic/claude-sonnet-4.5"),
  // Stronger model for the writing agent (Unit 06).
  WRITING_MODEL: z.string().min(1).default("anthropic/claude-opus-4.8"),
  // "mock" swaps the OpenRouter-backed LLMs for deterministic canned ones
  // (Unit 23 — the golden-path E2E's stubbed model). Streaming, projections,
  // approvals, and the org-key path all stay real. NEVER set in production;
  // the worker warn-logs loudly at boot when this is on.
  LLM_MODE: z.enum(["live", "mock"]).default("live"),
  // Optional publish target. When set, the publish activity POSTs the draft with
  // an Idempotency-Key header; when absent it simulates delivery.
  PUBLISH_WEBHOOK_URL: z.url().optional(),
});

export const env = envSchema.parse(process.env);
