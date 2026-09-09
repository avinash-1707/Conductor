"use client";

import { useEffect } from "react";
import type {
  CanvasDraftResource,
  CanvasOperationApplied,
  CanvasOperationRequest,
} from "@conductor/shared";
import { useRunEventsContext, type ConnectionStatus } from "@/components/app/run-events-provider";

type JoinResponse =
  | { ok: true; draft: CanvasDraftResource }
  | { ok: false; code: "not_found" | "forbidden" | "bad_request" };

/** Uses the authenticated app socket for one collaborative canvas room. */
export function useCanvasEvents(
  draftId: string | null | undefined,
  onOperation: (event: CanvasOperationApplied) => void,
  onJoin: (response: JoinResponse) => void,
): {
  status: ConnectionStatus;
  sendOperation: (
    request: CanvasOperationRequest,
  ) => ReturnType<ReturnType<typeof useRunEventsContext>["sendCanvasOperation"]>;
} {
  const { status, subscribeCanvas, sendCanvasOperation } = useRunEventsContext();

  useEffect(() => {
    if (!draftId) return;
    return subscribeCanvas(draftId, onOperation, onJoin);
  }, [draftId, onJoin, onOperation, subscribeCanvas]);

  return { status, sendOperation: sendCanvasOperation };
}
