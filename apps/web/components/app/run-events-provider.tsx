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
import { runEventSchema, type RunEvent } from "@conductor/shared";
import { SERVER_URL } from "@/lib/config";
import { getApiJwt } from "@/lib/jwt";

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "offline";

type Handler = (event: RunEvent) => void;

interface RunEventsContext {
  status: ConnectionStatus;
  subscribe: (runId: string, handler: Handler, onReconnect?: () => void) => () => void;
}

const Ctx = createContext<RunEventsContext | null>(null);

/**
 * Owns the single Socket.IO connection for the authed app (code-standards:
 * components never construct sockets themselves — they subscribe through this
 * context). Socket.IO handles reconnection/backoff; on every (re)connect we
 * re-join the rooms for all active run ids, and on a *re*connect we fire each
 * subscriber's onReconnect so it can refetch the projections (the read source
 * of truth) and reconcile any tail dropped while offline.
 */
export function RunEventsProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const handlers = useRef(new Map<string, Set<Handler>>());
  const onReconnects = useRef(new Map<string, Set<() => void>>());
  const socketRef = useRef<Socket | null>(null);
  const everConnected = useRef(false);

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
      for (const runId of handlers.current.keys()) socket.emit("subscribe", runId);
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
          socketRef.current?.emit("subscribe", runId);
        }
        hset.add(handler);

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
            socketRef.current?.emit("unsubscribe", runId);
          }
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
