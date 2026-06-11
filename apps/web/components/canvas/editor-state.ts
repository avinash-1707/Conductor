import type { Edge } from "@xyflow/react";
import {
  GRAPH_SPEC_VERSION,
  executionOrder,
  graphSpecSchema,
  type GraphNode,
  type GraphNodeType,
  type GraphSpec,
} from "@conductor/shared";
import { X_GAP, type SpecFlowNode } from "./layout";

/**
 * Pure editor logic (Unit 31). The editor never owns its own validator: the
 * candidate spec is serialized and parsed with the SAME shared graphSpecSchema
 * the server runs at its boundaries, and the Zod issues are mapped back onto
 * node/edge ids for inline display — round-trip-by-construction.
 */

/** Mirrors the shared nodeIdSchema slug rule (errors render inline in the panel). */
export const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function slugError(id: string, takenIds: string[]): string | null {
  if (id.length === 0) return "Step ids can't be empty.";
  if (id.length > 64) return "Step ids are 64 characters max.";
  if (!NODE_ID_PATTERN.test(id))
    return "Use a lowercase slug: letters, numbers, dashes.";
  if (takenIds.includes(id)) return `"${id}" is already taken.`;
  return null;
}

function makeGraphNode(type: GraphNodeType, id: string): GraphNode {
  switch (type) {
    case "research":
      return { id, type: "research", config: {} };
    case "approval":
      return { id, type: "approval", config: {} };
    case "write":
      return { id, type: "write", config: {} };
    case "publish":
      return { id, type: "publish", config: {} };
  }
}

/** First free id for a type: `research`, then `research-2`, `research-3`, … */
export function nextNodeId(type: GraphNodeType, nodes: SpecFlowNode[]): string {
  const taken = new Set(nodes.map((n) => n.id));
  if (!taken.has(type)) return type;
  for (let i = 2; ; i++) {
    const candidate = `${type}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function makeEditorNode(
  type: GraphNodeType,
  id: string,
  position: { x: number; y: number },
): SpecFlowNode {
  return {
    id,
    type: "spec",
    position,
    data: { node: makeGraphNode(type, id) },
    // One-shot 160ms enter — feedback that the add landed (mount-only).
    className: "node-enter",
  };
}

/**
 * The unique end of the current chain (a node with no outgoing edge), used by
 * click-to-add to auto-draw the connecting edge. Ambiguous layouts (several
 * loose ends) return null — the user wires those by hand and validation
 * narrates the rest.
 */
export function chainTail(nodes: SpecFlowNode[], edges: Edge[]): string | null {
  const hasOutgoing = new Set(edges.map((e) => e.source));
  const tails = nodes.filter((n) => !hasOutgoing.has(n.id));
  return tails.length === 1 ? tails[0]!.id : null;
}

/** Immutable config update for one node (panel edits). */
export function withNodeConfig(
  nodes: SpecFlowNode[],
  id: string,
  config: GraphNode["config"],
): SpecFlowNode[] {
  return nodes.map((n) =>
    n.id === id
      ? { ...n, data: { ...n.data, node: { ...n.data.node, config } as GraphNode } }
      : n,
  );
}

/** Immutable rename — node id, its payload, and every referencing edge. */
export function withNodeId(
  nodes: SpecFlowNode[],
  edges: Edge[],
  oldId: string,
  newId: string,
): { nodes: SpecFlowNode[]; edges: Edge[] } {
  return {
    nodes: nodes.map((n) =>
      n.id === oldId
        ? { ...n, id: newId, data: { ...n.data, node: { ...n.data.node, id: newId } } }
        : n,
    ),
    edges: edges.map((e) => ({
      ...e,
      id: `${e.source === oldId ? newId : e.source}->${e.target === oldId ? newId : e.target}`,
      source: e.source === oldId ? newId : e.source,
      target: e.target === oldId ? newId : e.target,
    })),
  };
}

/**
 * A saved spec opened back into the editor (Unit 32): chain-ordered layout
 * like the viewer, but editable nodes (no enter animation — opening is not
 * adding). Editing a reopened version saves as the NEXT version.
 */
export function editorGraphFromSpec(spec: GraphSpec): {
  nodes: SpecFlowNode[];
  edges: Edge[];
} {
  const nodes = executionOrder(spec).map((node, index) => ({
    id: node.id,
    type: "spec" as const,
    position: { x: index * X_GAP, y: 0 },
    data: { node },
  }));
  const edges = spec.edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
  }));
  return { nodes, edges };
}

/**
 * Semantic spec equality (Unit 32 dirty-tracking). Stored JSONB normalizes key
 * order and the editor's insertion order can differ from chain order, so both
 * sides compare by execution order — which, with the name, fully determines a
 * valid v1 (linear) spec.
 */
export function specsEqual(a: GraphSpec, b: GraphSpec): boolean {
  if (a.name !== b.name) return false;
  const orderA = executionOrder(a);
  const orderB = executionOrder(b);
  if (orderA.length !== orderB.length) return false;
  return orderA.every((node, i) => {
    const other = orderB[i]!;
    return (
      node.id === other.id &&
      node.type === other.type &&
      JSON.stringify([...Object.entries(node.config)].sort()) ===
        JSON.stringify([...Object.entries(other.config)].sort())
    );
  });
}

export type EditorIssue = {
  /** Stable list key (message + location). */
  key: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
};

export type EditorValidation = {
  /** The parsed spec when the graph is valid; null otherwise. */
  spec: GraphSpec | null;
  issues: EditorIssue[];
};

function toCandidate(name: string, nodes: SpecFlowNode[], edges: Edge[]) {
  return {
    specVersion: GRAPH_SPEC_VERSION,
    name,
    nodes: nodes.map((n) => n.data.node),
    edges: edges.map((e) => ({ from: e.source, to: e.target })),
  };
}

/**
 * Serialize the editor graph and run the shared schema. Issue paths come back
 * as ["nodes", i, …] / ["edges", i, …] and are mapped to the offending ids.
 */
export function validateEditor(
  name: string,
  nodes: SpecFlowNode[],
  edges: Edge[],
): EditorValidation {
  if (nodes.length === 0) {
    return {
      spec: null,
      issues: [{ key: "empty", message: "Add at least one step to the canvas." }],
    };
  }

  const candidate = toCandidate(name, nodes, edges);
  const parsed = graphSpecSchema.safeParse(candidate);
  if (parsed.success) return { spec: parsed.data, issues: [] };

  const issues: EditorIssue[] = [];
  const seen = new Set<string>();
  for (const issue of parsed.error.issues) {
    const [head, index] = issue.path;
    let nodeId: string | undefined;
    let edgeId: string | undefined;
    let message = issue.message;
    if (head === "name") {
      message = "Name your workflow (1–100 characters).";
    } else if (head === "nodes" && typeof index === "number") {
      nodeId = candidate.nodes[index]?.id;
    } else if (head === "edges" && typeof index === "number") {
      edgeId = edges[index]?.id;
    }
    const key = `${message}|${nodeId ?? ""}|${edgeId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ key, message, nodeId, edgeId });
  }
  return { spec: null, issues };
}
