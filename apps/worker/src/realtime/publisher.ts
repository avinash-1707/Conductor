import Redis from "ioredis";
import {
  redisChannels,
  runEventSchema,
  tokenStreamEventSchema,
  type RunEvent,
  type TokenStreamEvent,
} from "@conductor/shared";
import { env } from "../env";
import { logger } from "../logger";

/**
 * Live status publisher (Unit 17). Activities publish `RunEvent`s here as a run
 * progresses; the server relays them to subscribed WebSocket clients.
 *
 * Publishing is BEST-EFFORT by design: Redis is ephemeral (architecture storage
 * model), so a publish failure is logged and swallowed — it must never fail an
 * activity or a run. A dropped event is reconciled by the client refetching the
 * projections (the read source of truth) on reconnect.
 */
let client: Redis | undefined;

function redis(): Redis {
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // Live tails are disposable; never queue offline.
      enableOfflineQueue: false,
    });
    client.on("error", (err) => {
      logger.warn({ err }, "realtime publisher redis error");
    });
  }
  return client;
}

export async function publishRunEvent(event: RunEvent): Promise<void> {
  const parsed = runEventSchema.safeParse(event);
  if (!parsed.success) {
    logger.warn({ event, err: parsed.error.message }, "invalid run event, not published");
    return;
  }
  try {
    await redis().publish(
      redisChannels.status(parsed.data.runId),
      JSON.stringify(parsed.data),
    );
  } catch (err) {
    logger.warn({ err, runId: parsed.data.runId, type: parsed.data.type }, "run event publish failed");
  }
}

/**
 * Publishes one LLM token-stream chunk to the run's stream channel (Unit 20).
 * Same best-effort contract as {@link publishRunEvent}: a dropped chunk just
 * means a missing live tail — the final structured result still lands in the
 * activity's return value (Temporal payload), never here (architecture
 * invariant 8). Token deltas are small strings; no object ever rides this
 * channel.
 */
export async function publishTokenEvent(event: TokenStreamEvent): Promise<void> {
  const parsed = tokenStreamEventSchema.safeParse(event);
  if (!parsed.success) {
    logger.warn({ err: parsed.error.message }, "invalid token event, not published");
    return;
  }
  try {
    await redis().publish(
      redisChannels.stream(parsed.data.runId),
      JSON.stringify(parsed.data),
    );
  } catch (err) {
    logger.warn(
      { err, runId: parsed.data.runId, type: parsed.data.type },
      "token event publish failed",
    );
  }
}

/** Drains the publisher connection on worker shutdown. */
export async function closeRealtime(): Promise<void> {
  if (client) {
    await client.quit().catch(() => undefined);
    client = undefined;
  }
}
