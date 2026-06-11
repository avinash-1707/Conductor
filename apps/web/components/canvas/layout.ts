import type { Edge, Node } from "@xyflow/react";
import {
  executionOrder,
  type GraphNode,
  type GraphSpec,
  type RunStatus,
  type StepStatus,
} from "@conductor/shared";

/**
 * Pure spec → React Flow projection (Unit 30). v1 graphs are validated linear
 * chains, so layout is deterministic arithmetic — chain order left to right,
 * no measuring, no layout engine. The editor (Unit 31) replaces positions with
 * user-driven ones; this stays the read-only default.
 */

export type NodeStatus = RunStatus | StepStatus;

export type SpecNodeData = {
  node: GraphNode;
  /** Live step status for run-pinned views; absent on neutral spec views. */
  status?: NodeStatus;
  /** Editor-only (Unit 31): the node carries a validation issue. */
  invalid?: boolean;
};

export type SpecFlowNode = Node<SpecNodeData, "spec">;

/** Horizontal rhythm: node width (w-[232px]) + breathing room for the edge. */
export const X_GAP = 284;

export function layoutSpec(
  spec: GraphSpec,
  statuses?: Partial<Record<string, NodeStatus>>,
): { nodes: SpecFlowNode[]; edges: Edge[] } {
  const nodes = executionOrder(spec).map((node, index) => ({
    id: node.id,
    type: "spec" as const,
    position: { x: index * X_GAP, y: 0 },
    data: { node, status: statuses?.[node.id] },
    draggable: false,
    connectable: false,
    selectable: false,
  }));
  const edges = spec.edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
  }));
  return { nodes, edges };
}
