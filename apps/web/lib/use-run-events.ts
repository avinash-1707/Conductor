"use client";

import { useEffect } from "react";
import type { RunEvent } from "@conductor/shared";
import {
  useRunEventsContext,
  type ConnectionStatus,
} from "@/components/app/run-events-provider";

/**
 * Subscribe to live events for one run. The handler is kept in a ref-free
 * closure, so pass a stable callback (e.g. from `useCallback`) or accept that
 * re-subscription happens when it changes. `onReconnect` fires after the socket
 * recovers so the caller can refetch and reconcile a dropped tail.
 */
export function useRunEvents(
  runId: string | null | undefined,
  handler: (event: RunEvent) => void,
  opts?: { onReconnect?: () => void },
) {
  const { subscribe } = useRunEventsContext();
  const onReconnect = opts?.onReconnect;

  useEffect(() => {
    if (!runId) return;
    return subscribe(runId, handler, onReconnect);
  }, [runId, handler, onReconnect, subscribe]);
}

export function useConnectionStatus(): ConnectionStatus {
  return useRunEventsContext().status;
}
