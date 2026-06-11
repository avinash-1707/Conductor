import Redis from "ioredis";
import { env } from "./env";

/**
 * Tiny best-effort Redis cache door (Unit 33). Redis is ephemeral by the
 * architecture's storage model — Postgres is the source of truth — so cache
 * operations warn-log and swallow failures; a missed invalidation only means
 * the worker reads a value up to its TTL stale, never wrong forever.
 */
let client: Redis | undefined;

function redis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    client.on("error", () => {
      // Logged at the call site with request context; the handler here only
      // stops ioredis from emitting an unhandled-error crash.
    });
  }
  return client;
}

/** Lazy first-use connect: without it the first command races the handshake
 *  (offline queueing is off) and would always fail. Connect failures are
 *  swallowed — the command below then fails fast and reports false. */
async function ready(): Promise<Redis> {
  const c = redis();
  if (c.status === "wait") {
    await c.connect().catch(() => undefined);
  }
  return c;
}

/** Deletes a cache key; returns false (and never throws) when Redis is unreachable. */
export async function cacheDelete(key: string): Promise<boolean> {
  try {
    await (await ready()).del(key);
    return true;
  } catch {
    return false;
  }
}

/** Closes the cache connection on server shutdown. */
export async function closeCache(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = undefined;
  }
}
