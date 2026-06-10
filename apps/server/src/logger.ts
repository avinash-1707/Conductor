import pino from "pino";
import { env } from "./env";

/**
 * The server's pino logger (JSON output) for bootstrap/shutdown logging
 * (`console` is forbidden — code-standards Scalability & Operations). Fastify
 * builds its own request-scoped pino with the same options in `app.ts`, so
 * request lines carry `requestId`.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: "server" },
});
