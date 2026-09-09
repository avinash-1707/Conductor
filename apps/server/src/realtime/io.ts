import type { Server as HttpServer } from "node:http";
import Redis from "ioredis";
import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import {
  canvasJoinRequestSchema,
  canvasJoinResponseSchema,
  canvasOperationAppliedSchema,
  canvasOperationRequestSchema,
  canvasOperationResponseSchema,
  runEventSchema,
  tokenStreamEventSchema,
} from "@conductor/shared";
import { and, eq } from "drizzle-orm";
import { member } from "@conductor/db";
import type { VerifyToken } from "../auth/verify";
import { db } from "../db/client";
import { toCanvasDraftResource } from "../routes/canvas-drafts";
import { logger } from "../logger";
import { repos } from "../repos/index";

/**
 * Socket.IO realtime relay (Unit 17). The worker publishes `RunEvent`s to Redis
 * (`run:{id}:status`) and LLM token deltas (`run:{id}:stream`, Unit 20); this
 * server `psubscribe`s both patterns and emits each event into the Socket.IO
 * room named after the run id (`run.event` for status, `run.stream` for
 * tokens). Every server instance
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
  userId: string;
}

const STATUS_RE = /^run:(.+):status$/;
const STREAM_RE = /^run:(.+):stream$/;

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

  // Peer-originated canvas edits need a Socket.IO adapter; the existing Redis
  // subscriber only relays worker-originated events into this process.
  const adapterPub = new Redis(redisUrl, { lazyConnect: false });
  const adapterSub = adapterPub.duplicate();
  adapterPub.on("error", (err) => logger.warn({ err }, "realtime adapter publisher redis error"));
  adapterSub.on("error", (err) => logger.warn({ err }, "realtime adapter subscriber redis error"));
  io.adapter(createAdapter(adapterPub, adapterSub));

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
      (socket.data as SocketData).userId = claims.userId;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const { orgId, userId } = socket.data as SocketData;

    // Every authed socket joins its org's room (Unit 23): org-wide events
    // (new approval requests) reach the queue/badge without a run subscription.
    void socket.join(`org:${orgId}`);

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

    async function membershipRole(): Promise<string | undefined> {
      const rows = await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
        .limit(1);
      return rows[0]?.role;
    }

    socket.on("canvas.join", async (raw: unknown, ack?: (res: unknown) => void) => {
      const request = canvasJoinRequestSchema.safeParse(raw);
      if (!request.success) {
        ack?.(canvasJoinResponseSchema.parse({ ok: false, code: "bad_request" }));
        return;
      }
      if (!(await membershipRole())) {
        ack?.(canvasJoinResponseSchema.parse({ ok: false, code: "not_found" }));
        return;
      }
      const draft = await repos.canvasDrafts.findDraftById({ orgId, id: request.data.draftId });
      if (!draft) {
        ack?.(canvasJoinResponseSchema.parse({ ok: false, code: "not_found" }));
        return;
      }
      await socket.join(`canvas:${draft.id}`);
      ack?.(canvasJoinResponseSchema.parse({ ok: true, draft: toCanvasDraftResource(draft) }));
    });

    socket.on("canvas.leave", (raw: unknown) => {
      const request = canvasJoinRequestSchema.safeParse(raw);
      if (request.success) void socket.leave(`canvas:${request.data.draftId}`);
    });

    socket.on("canvas.operation", async (raw: unknown, ack?: (res: unknown) => void) => {
      const request = canvasOperationRequestSchema.safeParse(raw);
      if (!request.success) {
        ack?.(canvasOperationResponseSchema.parse({ ok: false, code: "bad_request" }));
        return;
      }
      if ((await membershipRole()) !== "owner") {
        ack?.(canvasOperationResponseSchema.parse({ ok: false, code: "forbidden" }));
        return;
      }
      try {
        const result = await repos.canvasDrafts.applyOperation({
          orgId,
          userId,
          ...request.data,
        });
        if (result.kind === "not_found") {
          ack?.(canvasOperationResponseSchema.parse({ ok: false, code: "not_found" }));
          return;
        }
        if (result.kind === "closed") {
          ack?.(canvasOperationResponseSchema.parse({ ok: false, code: "closed" }));
          return;
        }
        if (result.kind === "idempotency_mismatch") {
          ack?.(canvasOperationResponseSchema.parse({ ok: false, code: "bad_request" }));
          return;
        }
        if (result.kind === "stale") {
          ack?.(
            canvasOperationResponseSchema.parse({
              ok: false,
              code: "stale_revision",
              draft: toCanvasDraftResource(result.draft),
            }),
          );
          return;
        }
        const response = canvasOperationResponseSchema.parse({
          ok: true,
          revision: result.revision,
          operation: result.operation,
        });
        ack?.(response);
        if (!result.idempotent) {
          io.to(`canvas:${request.data.draftId}`).emit(
            "canvas.operation.applied",
            canvasOperationAppliedSchema.parse({
              draftId: request.data.draftId,
              revision: result.revision,
              operation: result.operation,
            }),
          );
        }
      } catch (err) {
        logger.warn({ err, draftId: request.data.draftId }, "canvas operation rejected");
        ack?.(canvasOperationResponseSchema.parse({ ok: false, code: "bad_request" }));
      }
    });
  });

  // Dedicated subscriber connection (a subscribed Redis client can run no other
  // commands). psubscribe both patterns once; emit each event into its run's
  // room — status events as `run.event`, token deltas as `run.stream`.
  const sub = new Redis(redisUrl, { lazyConnect: false });
  sub.on("error", (err) => logger.warn({ err }, "realtime subscriber redis error"));
  void sub.psubscribe("run:*:status", "run:*:stream").catch((err) => {
    logger.error({ err }, "failed to psubscribe to run channels");
  });
  sub.on("pmessage", (_pattern: string, channel: string, message: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }

    const statusMatch = STATUS_RE.exec(channel);
    if (statusMatch) {
      const runId = statusMatch[1] as string;
      const event = runEventSchema.safeParse(parsed);
      if (!event.success) {
        logger.warn({ channel }, "dropping malformed run event");
        return;
      }
      io.to(runId).emit("run.event", event.data);
      // New approval requests also fan out org-wide (the event carries its
      // org, set by the worker from the verified workflow input) so the
      // Approval Queue and sidebar badge update live (Unit 23).
      if (event.data.type === "approval.requested") {
        io.to(`org:${event.data.orgId}`).emit("approval.event", event.data);
      }
      return;
    }

    const streamMatch = STREAM_RE.exec(channel);
    if (streamMatch) {
      const runId = streamMatch[1] as string;
      const event = tokenStreamEventSchema.safeParse(parsed);
      if (!event.success) {
        logger.warn({ channel }, "dropping malformed token event");
        return;
      }
      io.to(runId).emit("run.stream", event.data);
    }
  });

  return {
    async close() {
      await sub.quit().catch(() => undefined);
      await adapterPub.quit().catch(() => undefined);
      await adapterSub.quit().catch(() => undefined);
      await io.close();
    },
  };
}
