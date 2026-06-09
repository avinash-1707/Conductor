import pino from "pino";

/**
 * The worker's pino logger (JSON output). `console.log` is forbidden outside
 * scripts (architecture Scalability & Operations). Child loggers add
 * correlation context (activity, attempt, runId) where it exists.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { app: "worker" },
});
