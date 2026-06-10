import { Pool } from "pg";
import Redis from "ioredis";
import { Connection } from "@temporalio/client";
import type { Env } from "./env";

/**
 * Dependency connectivity checks used by `/ready`. Each is defensive and
 * timeout-bounded — a check returns `false` rather than throwing, so a degraded
 * dependency surfaces as `not_ready`, never as a crashed handler. The checks are
 * injected into the app so inject tests run without live infrastructure.
 */
export interface ReadinessChecks {
  postgres(): Promise<boolean>;
  redis(): Promise<boolean>;
  temporal(): Promise<boolean>;
}

export interface Deps {
  checks: ReadinessChecks;
  /** Lazily-created shared Temporal gRPC connection (readiness + workflow client). */
  temporalConnection(): Promise<Connection>;
  close(): Promise<void>;
}

const CHECK_TIMEOUT_MS = 3_000;

/** Resolves to `false` if the probe rejects or exceeds the timeout. */
async function probe(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("readiness check timed out")), CHECK_TIMEOUT_MS),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the singleton clients and the readiness checks over them. Clients are
 * created once and reused (connection pooling); `close()` drains them on
 * graceful shutdown.
 */
export function createDeps(env: Env): Deps {
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  let temporalConnection: Connection | undefined;
  async function temporalConn(): Promise<Connection> {
    if (!temporalConnection) {
      temporalConnection = await Connection.connect({ address: env.TEMPORAL_ADDRESS });
    }
    return temporalConnection;
  }

  const checks: ReadinessChecks = {
    postgres: () => probe(() => pool.query("SELECT 1")),
    redis: () =>
      probe(async () => {
        if (redis.status !== "ready" && redis.status !== "connecting") {
          await redis.connect();
        }
        await redis.ping();
      }),
    temporal: () =>
      probe(async () => {
        const conn = await temporalConn();
        await conn.workflowService.getSystemInfo({});
      }),
  };

  async function close(): Promise<void> {
    await Promise.allSettled([
      pool.end(),
      redis.quit(),
      temporalConnection?.close() ?? Promise.resolve(),
    ]);
  }

  return { checks, temporalConnection: temporalConn, close };
}
