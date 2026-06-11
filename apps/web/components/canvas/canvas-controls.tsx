"use client";

import { Panel, useReactFlow, type FitViewOptions } from "@xyflow/react";
import { Maximize, Minus, Plus } from "lucide-react";

/**
 * The shared token-styled zoom strip (Unit 30; reused by the editor in Unit
 * 31) — React Flow's stock controls are unthemed. Zoom jumps are instant:
 * a high-frequency control earns no animation (motion principles).
 */

const CONTROL_BTN =
  "grid h-7 w-7 place-items-center rounded-md border border-line bg-surface/80 text-muted backdrop-blur transition-colors duration-150 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export const DEFAULT_FIT_VIEW: FitViewOptions = { padding: 0.15, maxZoom: 1 };

export function CanvasControls({
  fitViewOptions = DEFAULT_FIT_VIEW,
}: {
  fitViewOptions?: FitViewOptions;
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="bottom-left" className="flex gap-1">
      <button
        type="button"
        aria-label="Zoom in"
        className={CONTROL_BTN}
        onClick={() => void zoomIn({ duration: 0 })}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        className={CONTROL_BTN}
        onClick={() => void zoomOut({ duration: 0 })}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label="Fit view"
        className={CONTROL_BTN}
        onClick={() => void fitView(fitViewOptions)}
      >
        <Maximize className="h-3.5 w-3.5" />
      </button>
    </Panel>
  );
}
