import { z } from "zod";

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
  LOG_LEVEL: z.string().min(1).default("info"),
});

export type Env = z.infer<typeof envSchema>;
export const env = envSchema.parse(process.env);
