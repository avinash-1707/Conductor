"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  runEventSchema,
  tokenStreamEventSchema,
  type RunEvent,
  type TokenStreamEvent,
} from "@conductor/shared";
import { SERVER_URL } from "@/lib/config";
import { getApiJwt } from "@/lib/jwt";

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

type Handler = (event: RunEvent) => void;
type StreamHandler = (event: TokenStreamEvent) => void;

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
      if (everConnected.current) {
        for (const set of onReconnects.current.values())
          for (const fn of set) fn();
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

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

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
    }),
    [status],
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
