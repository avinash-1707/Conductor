"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import type { z } from "zod";
import {
  runEventSchema,
  tokenStreamEventSchema,
  canvasJoinResponseSchema,
  canvasOperationAppliedSchema,
  canvasOperationRequestSchema,
  canvasOperationResponseSchema,
  type CanvasOperationApplied,
  type CanvasOperationRequest,
  type RunEvent,
  type TokenStreamEvent,
} from "@conductor/shared";
import { SERVER_URL } from "@/lib/config";
import { getApiJwt } from "@/lib/jwt";

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

type Handler = (event: RunEvent) => void;
type StreamHandler = (event: TokenStreamEvent) => void;
type CanvasJoinResponse = z.infer<typeof canvasJoinResponseSchema>;
type CanvasOperationResponse = z.infer<typeof canvasOperationResponseSchema>;
type CanvasHandler = (event: CanvasOperationApplied) => void;
type CanvasJoinHandler = (response: CanvasJoinResponse) => void;

interface RunEventsContext {
  status: ConnectionStatus;
  subscribe: (runId: string, handler: Handler, onReconnect?: () => void) => () => void;
  subscribeStream: (runId: string, handler: StreamHandler) => () => void;
  /**
   * Org-wide approval events (Unit 23): every authed socket is in its org's
   * room server-side, so no run subscription is needed — new approval
   * requests arrive here and the queue/badge invalidate their shared cache.
   */
  subscribeApprovals: (handler: Handler) => () => void;
  /** Joins a collaborative canvas room and re-joins it after reconnecting. */
  subscribeCanvas: (
    draftId: string,
    handler: CanvasHandler,
    onJoin: CanvasJoinHandler,
  ) => () => void;
  /** Sends an acknowledged, revisioned canvas operation through the app socket. */
  sendCanvasOperation: (request: CanvasOperationRequest) => Promise<CanvasOperationResponse>;
}

const Ctx = createContext<RunEventsContext | null>(null);

/**
 * Owns the single Socket.IO connection for the authed app (code-standards:
 * components never construct sockets themselves — they subscribe through this
 * context). Socket.IO handles reconnection/backoff; on every (re)connect we
 * re-join the rooms for all active run ids, and on a *re*connect we fire each
 * subscriber's onReconnect so it can refetch the projections (the read source
 * of truth) and reconcile any tail dropped while offline.
 *
 * Two event kinds share each per-run room: status events (`run.event`) and LLM
 * token deltas (`run.stream`, Unit 20). Room membership is reference-counted
 * across both subscription kinds, so a run id stays joined while either a
 * status or a stream subscriber is live.
 */
export function RunEventsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const handlers = useRef(new Map<string, Set<Handler>>());
  const streamHandlers = useRef(new Map<string, Set<StreamHandler>>());
  const approvalHandlers = useRef(new Set<Handler>());
  const onReconnects = useRef(new Map<string, Set<() => void>>());
  const roomRefs = useRef(new Map<string, number>());
  const canvasHandlers = useRef(new Map<string, Set<CanvasHandler>>());
  const canvasJoinHandlers = useRef(new Map<string, Set<CanvasJoinHandler>>());
  const canvasRoomRefs = useRef(new Map<string, number>());
  const socketRef = useRef<Socket | null>(null);
  const everConnected = useRef(false);

  // Join a run's room on the 0→1 transition; leave on →0.
  function joinRoom(runId: string) {
    const next = (roomRefs.current.get(runId) ?? 0) + 1;
    roomRefs.current.set(runId, next);
    if (next === 1) socketRef.current?.emit("subscribe", runId);
  }
  function releaseRoom(runId: string) {
    const next = (roomRefs.current.get(runId) ?? 1) - 1;
    if (next <= 0) {
      roomRefs.current.delete(runId);
      socketRef.current?.emit("unsubscribe", runId);
    } else {
      roomRefs.current.set(runId, next);
    }
  }

  const joinCanvas = useCallback((draftId: string) => {
    const socket = socketRef.current;
    if (!socket?.connected) return;
    socket.emit("canvas.join", { draftId }, (raw: unknown) => {
      const parsed = canvasJoinResponseSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const fn of canvasJoinHandlers.current.get(draftId) ?? []) fn(parsed.data);
    });
  }, []);

  const joinCanvasRoom = useCallback(
    (draftId: string) => {
      const next = (canvasRoomRefs.current.get(draftId) ?? 0) + 1;
      canvasRoomRefs.current.set(draftId, next);
      if (next === 1) joinCanvas(draftId);
    },
    [joinCanvas],
  );

  const releaseCanvasRoom = useCallback((draftId: string) => {
    const next = (canvasRoomRefs.current.get(draftId) ?? 1) - 1;
    if (next <= 0) {
      canvasRoomRefs.current.delete(draftId);
      socketRef.current?.emit("canvas.leave", { draftId });
    } else {
      canvasRoomRefs.current.set(draftId, next);
    }
  }, []);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      path: "/ws",
      transports: ["websocket"],
      auth: (cb) => {
        // Called on every (re)connection attempt — always sends a fresh JWT.
        void getApiJwt().then((token) => cb({ token: token ?? "" }));
      },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("live");
      // Rooms are per-socket and lost on reconnect; re-join every active run.
      for (const runId of roomRefs.current.keys()) socket.emit("subscribe", runId);
      for (const draftId of canvasRoomRefs.current.keys()) joinCanvas(draftId);
      if (everConnected.current) {
        for (const set of onReconnects.current.values()) for (const fn of set) fn();
      }
      everConnected.current = true;
    });
    socket.on("disconnect", () => setStatus("reconnecting"));
    socket.on("connect_error", () => {
      setStatus(everConnected.current ? "reconnecting" : "offline");
    });
    socket.on("run.event", (raw: unknown) => {
      const parsed = runEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const set = handlers.current.get(parsed.data.runId);
      if (set) for (const fn of set) fn(parsed.data);
    });
    socket.on("run.stream", (raw: unknown) => {
      const parsed = tokenStreamEventSchema.safeParse(raw);
      if (!parsed.success) return;
      const set = streamHandlers.current.get(parsed.data.runId);
      if (set) for (const fn of set) fn(parsed.data);
    });
    socket.on("approval.event", (raw: unknown) => {
      const parsed = runEventSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const fn of approvalHandlers.current) fn(parsed.data);
    });
    socket.on("canvas.operation.applied", (raw: unknown) => {
      const parsed = canvasOperationAppliedSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const fn of canvasHandlers.current.get(parsed.data.draftId) ?? []) fn(parsed.data);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [joinCanvas]);

  const value = useMemo<RunEventsContext>(
    () => ({
      status,
      subscribe(runId, handler, onReconnect) {
        let hset = handlers.current.get(runId);
        if (!hset) {
          hset = new Set();
          handlers.current.set(runId, hset);
        }
        hset.add(handler);
        joinRoom(runId);

        let rset: Set<() => void> | undefined;
        if (onReconnect) {
          rset = onReconnects.current.get(runId) ?? new Set();
          onReconnects.current.set(runId, rset);
          rset.add(onReconnect);
        }

        return () => {
          const hs = handlers.current.get(runId);
          hs?.delete(handler);
          if (onReconnect) rset?.delete(onReconnect);
          if (hs && hs.size === 0) {
            handlers.current.delete(runId);
            onReconnects.current.delete(runId);
          }
          releaseRoom(runId);
        };
      },
      subscribeStream(runId, handler) {
        let sset = streamHandlers.current.get(runId);
        if (!sset) {
          sset = new Set();
          streamHandlers.current.set(runId, sset);
        }
        sset.add(handler);
        joinRoom(runId);

        return () => {
          const ss = streamHandlers.current.get(runId);
          ss?.delete(handler);
          if (ss && ss.size === 0) streamHandlers.current.delete(runId);
          releaseRoom(runId);
        };
      },
      subscribeApprovals(handler) {
        // No room management: the server joins the org room at handshake.
        approvalHandlers.current.add(handler);
        return () => {
          approvalHandlers.current.delete(handler);
        };
      },
      subscribeCanvas(draftId, handler, onJoin) {
        const hset = canvasHandlers.current.get(draftId) ?? new Set<CanvasHandler>();
        canvasHandlers.current.set(draftId, hset);
        hset.add(handler);
        const jset = canvasJoinHandlers.current.get(draftId) ?? new Set<CanvasJoinHandler>();
        canvasJoinHandlers.current.set(draftId, jset);
        jset.add(onJoin);
        joinCanvasRoom(draftId);

        return () => {
          canvasHandlers.current.get(draftId)?.delete(handler);
          canvasJoinHandlers.current.get(draftId)?.delete(onJoin);
          if (canvasHandlers.current.get(draftId)?.size === 0) {
            canvasHandlers.current.delete(draftId);
            canvasJoinHandlers.current.delete(draftId);
          }
          releaseCanvasRoom(draftId);
        };
      },
      sendCanvasOperation(request) {
        const payload = canvasOperationRequestSchema.parse(request);
        const socket = socketRef.current;
        if (!socket?.connected) return Promise.reject(new Error("Collaboration is offline"));
        return new Promise<CanvasOperationResponse>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error("The collaboration server did not respond")),
            8_000,
          );
          socket.emit("canvas.operation", payload, (raw: unknown) => {
            window.clearTimeout(timeout);
            const parsed = canvasOperationResponseSchema.safeParse(raw);
            if (!parsed.success) {
              reject(new Error("The collaboration server returned an invalid response"));
              return;
            }
            resolve(parsed.data);
          });
        });
      },
    }),
    [joinCanvasRoom, releaseCanvasRoom, status],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRunEventsContext(): RunEventsContext {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useRunEvents must be used within a RunEventsProvider");
  }
  return ctx;
}
