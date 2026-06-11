"use client";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Maximize, Minus, Plus } from "lucide-react";
import type { GraphSpec } from "@conductor/shared";
import { layoutSpec, type NodeStatus } from "./layout";
import { SpecNode } from "./spec-node";

/**
 * Read-only graph_spec canvas (Unit 30). Pan + zoom only — nodes are fixed,
 * laid out by the pure chain projection in `layout.ts`. Motion is deliberately
 * minimal (ops console): zoom controls jump instantly, no mount choreography,
 * no edge animation; the only recurring motion is the running StatusDot pulse.
 * Token overrides for React Flow internals live in globals.css (.spec-canvas).
 */

const nodeTypes = { spec: SpecNode };

const defaultEdgeOptions = {
  style: { stroke: "var(--border-default)", strokeWidth: 1.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: "var(--border-default)",
    width: 18,
    height: 18,
  },
};

const fitViewOptions = { padding: 0.15, maxZoom: 1 };

const CONTROL_BTN =
  "grid h-7 w-7 place-items-center rounded-md border border-line bg-surface/80 text-muted backdrop-blur transition-colors duration-150 hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** Minimal themed zoom strip — React Flow's stock controls are unthemed. */
function CanvasControls() {
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

export function SpecCanvas({
  spec,
  statuses,
  className = "",
}: {
  spec: GraphSpec;
  /** Live step statuses keyed by node id (run-pinned views). */
  statuses?: Partial<Record<string, NodeStatus>>;
  className?: string;
}) {
  const { nodes, edges } = useMemo(() => layoutSpec(spec, statuses), [spec, statuses]);

  return (
    <div
      className={`spec-canvas h-[320px] w-full overflow-hidden rounded-xl border border-line-soft bg-inset lg:h-[380px] ${className}`}
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          fitViewOptions={fitViewOptions}
          minZoom={0.4}
          maxZoom={1.4}
          panOnScroll
          zoomOnScroll={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={26}
            size={1.4}
            color="var(--border-subtle)"
          />
          <CanvasControls />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
