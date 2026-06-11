"use client";

import { useCallback, useEffect, type DragEvent } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { MousePointerClick } from "lucide-react";
import { graphNodeTypeSchema, type GraphNodeType } from "@conductor/shared";
import type { SpecFlowNode } from "./layout";
import { SpecNode } from "./spec-node";
import { CanvasControls } from "./canvas-controls";
import { SPEC_EDGE_OPTIONS } from "./spec-canvas";
import { NODE_DND_TYPE } from "./node-palette";

/**
 * The editable canvas (Unit 31). Same skin as the viewer, plus interaction:
 * draggable nodes, connectable handles, Backspace/Delete removal, and a drop
 * target for palette drags. Structural rules are NOT prevented here — drawing
 * a second outgoing edge is allowed and then *narrated* by the shared schema
 * (one validator, precise errors), never silently blocked.
 */

const nodeTypes = { spec: SpecNode };

/** Action feedback while drawing a connection — dashed accent. */
const connectionLineStyle = {
  stroke: "var(--accent-primary)",
  strokeWidth: 1.5,
  strokeDasharray: "6 4",
};

type EditorCanvasProps = {
  nodes: SpecFlowNode[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange<SpecFlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onDropNode: (type: GraphNodeType, position: { x: number; y: number }) => void;
  /** Bump to refit the viewport (click-to-add appends past the right edge). */
  fitSignal?: number;
};

function EditorCanvasInner(props: EditorCanvasProps) {
  const { screenToFlowPosition, fitView } = useReactFlow();

  const { fitSignal } = props;
  useEffect(() => {
    if (!fitSignal) return;
    // Instant refit (no animated zoom — motion principles); next frame so the
    // freshly added node is measured first.
    const frame = requestAnimationFrame(() =>
      void fitView({ padding: 0.2, maxZoom: 1, duration: 0 }),
    );
    return () => cancelAnimationFrame(frame);
  }, [fitSignal, fitView]);

  const onDragOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes(NODE_DND_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      const parsed = graphNodeTypeSchema.safeParse(
        event.dataTransfer.getData(NODE_DND_TYPE),
      );
      if (!parsed.success) return;
      event.preventDefault();
      props.onDropNode(
        parsed.data,
        screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      );
    },
    [props, screenToFlowPosition],
  );

  return (
    <ReactFlow
      nodes={props.nodes}
      edges={props.edges}
      nodeTypes={nodeTypes}
      onNodesChange={props.onNodesChange}
      onEdgesChange={props.onEdgesChange}
      onConnect={props.onConnect}
      onDragOver={onDragOver}
      onDrop={onDrop}
      defaultEdgeOptions={SPEC_EDGE_OPTIONS}
      connectionLineStyle={connectionLineStyle}
      deleteKeyCode={["Backspace", "Delete"]}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
      minZoom={0.3}
      maxZoom={1.4}
      panOnScroll
      zoomOnScroll={false}
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={26}
        size={1.4}
        color="var(--border-subtle)"
      />
      <CanvasControls />
    </ReactFlow>
  );
}

export function EditorCanvas(props: EditorCanvasProps) {
  return (
    <div className="spec-canvas relative h-full w-full overflow-hidden rounded-xl border border-line-soft bg-inset">
      <ReactFlowProvider>
        <EditorCanvasInner {...props} />
      </ReactFlowProvider>
      {props.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-lg border border-line-soft bg-surface text-muted">
              <MousePointerClick className="h-5 w-5" aria-hidden />
            </span>
            <p className="max-w-xs text-sm text-muted">
              Drag steps from the palette, or click one to add it.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
