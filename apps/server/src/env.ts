import { z } from "zod";
import { TASK_QUEUE } from "@conductor/shared";

/**
 * Server configuration, parsed once at startup. `DATABASE_URL`/`REDIS_URL`
 * default to the docker-compose local URLs so the server runs with zero config
 * locally (and inject tests don't throw at import); production overrides via env.
 */
const envSchema = z.object({
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  WEB_ORIGIN: z.string().min(1).default("http://localhost:3000"),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://conductor:conductor@localhost:5432/conductor"),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  TEMPORAL_ADDRESS: z.string().min(1).default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().min(1).default("default"),
  // Task queue override (Unit 23). Defaults to the shared constant; the
  // golden-path E2E starts runs on an isolated queue so a stale dev worker
  // can never pick them up. Must match the worker's value.
  TEMPORAL_TASK_QUEUE: z.string().min(1).default(TASK_QUEUE),
  LOG_LEVEL: z.string().min(1).default("info"),

  // --- Auth (Better Auth) ---
  // Min 32 chars. Defaulted to a clearly dev-only value so local runs/tests need
  // zero config; PRODUCTION MUST override with `openssl rand -base64 32`.
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .default("dev-only-insecure-better-auth-secret-change-me"),
  BETTER_AUTH_URL: z.string().min(1).default("http://localhost:4000"),
  // Google OAuth is enabled only when both are present.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  // --- Platform secrets ---
  // AES-256-GCM key (base64, decodes to 32 bytes) for encrypting per-org
  // OpenRouter API keys at rest (Unit 11). Defaulted to a clearly dev-only key
  // so local runs/tests need zero config; PRODUCTION MUST override with a real
  // key: `openssl rand -base64 32`.
  PLATFORM_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .default("ZGV2LW9ubHktaW5zZWN1cmUtcGxhdGZvcm0ta2V5ISE="),
});

export type Env = z.infer<typeof envSchema>;
export const env = envSchema.parse(process.env);
