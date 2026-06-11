"use client";

import { useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphSpec } from "@conductor/shared";
import { layoutSpec, type NodeStatus } from "./layout";
import { SpecNode } from "./spec-node";
import { CanvasControls, DEFAULT_FIT_VIEW } from "./canvas-controls";

/**
 * Read-only graph_spec canvas (Unit 30). Pan + zoom only — nodes are fixed,
 * laid out by the pure chain projection in `layout.ts`. Motion is deliberately
 * minimal (ops console): zoom controls jump instantly, no mount choreography,
 * no edge animation; the only recurring motion is the running StatusDot pulse.
 * Token overrides for React Flow internals live in globals.css (.spec-canvas).
 */

const nodeTypes = { spec: SpecNode };

export const SPEC_EDGE_OPTIONS = {
  style: { stroke: "var(--border-default)", strokeWidth: 1.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: "var(--border-default)",
    width: 18,
    height: 18,
  },
};

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
          defaultEdgeOptions={SPEC_EDGE_OPTIONS}
          fitView
          fitViewOptions={DEFAULT_FIT_VIEW}
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
