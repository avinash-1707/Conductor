import type { Server as HttpServer } from "node:http";
import Redis from "ioredis";
import { Server, type Socket } from "socket.io";
import { runEventSchema } from "@conductor/shared";
import type { VerifyToken } from "../auth/verify";
import { logger } from "../logger";
import { repos } from "../repos/index";

/**
 * Socket.IO realtime relay (Unit 17). The worker publishes `RunEvent`s to Redis
 * (`run:{id}:status`); this server `psubscribe`s that pattern and emits each
 * event into the Socket.IO room named after the run id. Every server instance
 * runs its own Redis subscriber, so fan-out works from any instance with no
 * sticky sessions and no socket.io cluster adapter (the events originate from
 * Redis, not from peer sockets).
 *
 * Auth rides on the handshake (`auth.token` — the same JWKS-verified API JWT as
 * REST). A client may only join the room of a run in its active org; cross-org
 * or unknown ids are refused. Relay is best-effort: a parse failure is logged,
 * never thrown, and clients reconcile by refetching on reconnect.
 */
export interface Realtime {
  close(): Promise<void>;
}

interface SocketData {
  orgId: string;
}

const CHANNEL_RE = /^run:(.+):status$/;

export function createRealtime(opts: {
  httpServer: HttpServer;
  verify: VerifyToken;
  redisUrl: string;
  corsOrigin: string;
}): Realtime {
  const { httpServer, verify, redisUrl, corsOrigin } = opts;

  const io = new Server(httpServer, {
    path: "/ws",
    serveClient: false,
    cors: { origin: corsOrigin, credentials: true },
  });

  // Handshake auth: verify the JWT and pin the active org on the socket.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error("unauthorized"));
      return;
    }
    try {
      const claims = await verify(token);
      if (!claims.activeOrganizationId) {
        next(new Error("no active organization"));
        return;
      }
      (socket.data as SocketData).orgId = claims.activeOrganizationId;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const { orgId } = socket.data as SocketData;

    socket.on("subscribe", async (runId: unknown, ack?: (res: unknown) => void) => {
      if (typeof runId !== "string") {
        ack?.({ ok: false, code: "bad_request" });
        return;
      }
      // Org-scoping: only runs in the caller's active org are joinable.
      const run = await repos.runs.findRunById({ orgId, id: runId }).catch(() => undefined);
      if (!run) {
        ack?.({ ok: false, code: "not_found" });
        return;
      }
      await socket.join(runId);
      ack?.({ ok: true });
    });

    socket.on("unsubscribe", (runId: unknown) => {
      if (typeof runId === "string") void socket.leave(runId);
    });
  });

  // Dedicated subscriber connection (a subscribed Redis client can run no other
  // commands). psubscribe once; emit each event into its run's room.
  const sub = new Redis(redisUrl, { lazyConnect: false });
  sub.on("error", (err) => logger.warn({ err }, "realtime subscriber redis error"));
  void sub.psubscribe("run:*:status").catch((err) => {
    logger.error({ err }, "failed to psubscribe to run status channels");
  });
  sub.on("pmessage", (_pattern: string, channel: string, message: string) => {
    const match = CHANNEL_RE.exec(channel);
    if (!match) return;
    const runId = match[1] as string;
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const event = runEventSchema.safeParse(parsed);
    if (!event.success) {
      logger.warn({ channel }, "dropping malformed run event");
      return;
    }
    io.to(runId).emit("run.event", event.data);
  });

  return {
    async close() {
      await sub.quit().catch(() => undefined);
      await io.close();
    },
  };
}
