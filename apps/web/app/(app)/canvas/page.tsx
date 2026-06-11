"use client";

import { useCallback, useMemo, useState } from "react";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { AlertCircle, CircleCheck } from "lucide-react";
import type { GraphNode, GraphNodeType } from "@conductor/shared";
import { Input, Label } from "@/components/app/ui";
import { X_GAP, type SpecFlowNode } from "@/components/canvas/layout";
import {
  chainTail,
  makeEditorNode,
  nextNodeId,
  validateEditor,
  withNodeConfig,
  withNodeId,
} from "@/components/canvas/editor-state";
import { NodePalette } from "@/components/canvas/node-palette";
import { EditorCanvas } from "@/components/canvas/editor-canvas";
import { ConfigPanel } from "@/components/canvas/config-panel";

/**
 * The canvas editor (Unit 31) — drafts a graph_spec visually. Validation runs
 * the shared graphSpecSchema on every change (the server's exact validator),
 * narrating issues inline before anything can be saved. Saving, versioning,
 * and launching arrive in Unit 32.
 */

/** Nodes + edges move together (auto-chained adds, renames, deletes). */
type Graph = { nodes: SpecFlowNode[]; edges: Edge[] };

/** Live validation chip — completed tone when sound, failed tone with a count. */
function ValidationChip({ issueCount }: { issueCount: number }) {
  if (issueCount === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-completed/25 bg-completed/12 px-2 py-0.5 font-mono text-xs text-completed">
        <CircleCheck className="h-3.5 w-3.5" aria-hidden />
        Valid pipeline
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-failed/25 bg-failed/12 px-2 py-0.5 font-mono text-xs text-failed">
      <AlertCircle className="h-3.5 w-3.5" aria-hidden />
      {issueCount} {issueCount === 1 ? "issue" : "issues"}
    </span>
  );
}

export default function CanvasPage() {
  const [name, setName] = useState("");
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [fitSignal, setFitSignal] = useState(0);
  const { nodes, edges } = graph;

  const validation = useMemo(
    () => validateEditor(name, nodes, edges),
    [name, nodes, edges],
  );

  // Issue flags ride into node data so offending frames tint failed.
  const decoratedNodes = useMemo(() => {
    const invalidIds = new Set(
      validation.issues.flatMap((i) => (i.nodeId ? [i.nodeId] : [])),
    );
    if (invalidIds.size === 0) return nodes;
    return nodes.map((n) =>
      invalidIds.has(n.id) ? { ...n, data: { ...n.data, invalid: true } } : n,
    );
  }, [nodes, validation.issues]);

  const selected = nodes.find((n) => n.selected) ?? null;

  const onNodesChange = useCallback(
    (changes: NodeChange<SpecFlowNode>[]) =>
      setGraph((g) => ({ ...g, nodes: applyNodeChanges(changes, g.nodes) })),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setGraph((g) => ({ ...g, edges: applyEdgeChanges(changes, g.edges) })),
    [],
  );
  const onConnect = useCallback(
    (connection: Connection) =>
      setGraph((g) => ({
        ...g,
        edges: addEdge(
          { ...connection, id: `${connection.source}->${connection.target}` },
          g.edges,
        ),
      })),
    [],
  );

  /** Click-to-add: append after the chain tail and auto-draw the edge. */
  const addToChain = useCallback((type: GraphNodeType) => {
    setGraph((g) => {
      const id = nextNodeId(type, g.nodes);
      const tail = chainTail(g.nodes, g.edges);
      const maxX = g.nodes.reduce((acc, n) => Math.max(acc, n.position.x), -X_GAP);
      return {
        nodes: [...g.nodes, makeEditorNode(type, id, { x: maxX + X_GAP, y: 0 })],
        edges: tail
          ? addEdge({ id: `${tail}->${id}`, source: tail, target: id }, g.edges)
          : g.edges,
      };
    });
    // Appended nodes land past the right edge — refit so the chain stays seen.
    setFitSignal((n) => n + 1);
  }, []);

  /** Palette drop: place exactly where it landed; the user wires it up. */
  const onDropNode = useCallback(
    (type: GraphNodeType, position: { x: number; y: number }) => {
      setGraph((g) => ({
        ...g,
        nodes: [...g.nodes, makeEditorNode(type, nextNodeId(type, g.nodes), position)],
      }));
    },
    [],
  );

  const onConfigChange = useCallback((id: string, config: GraphNode["config"]) => {
    setGraph((g) => ({ ...g, nodes: withNodeConfig(g.nodes, id, config) }));
  }, []);

  const onRename = useCallback((oldId: string, newId: string) => {
    setGraph((g) => withNodeId(g.nodes, g.edges, oldId, newId));
  }, []);

  const onDelete = useCallback((id: string) => {
    setGraph((g) => ({
      nodes: g.nodes.filter((n) => n.id !== id),
      edges: g.edges.filter((e) => e.source !== id && e.target !== id),
    }));
  }, []);

  const selectNode = useCallback((id: string) => {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => ({ ...n, selected: n.id === id })),
    }));
  }, []);

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar: the name becomes spec.name; the chip is the live verdict. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="workflow-name">Workflow name</Label>
          <Input
            id="workflow-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Research Digest"
            maxLength={100}
            className="w-72 max-w-full"
          />
        </div>
        <ValidationChip issueCount={validation.issues.length} />
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[14rem_1fr_18rem]">
        <NodePalette onAdd={addToChain} />
        <div className="flex min-h-[420px] flex-col gap-3 lg:h-[calc(100vh-15rem)]">
          <EditorCanvas
            nodes={decoratedNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDropNode={onDropNode}
            fitSignal={fitSignal}
          />
          {validation.issues.length > 0 && nodes.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label="Validation issues">
              {validation.issues.map((issue) => (
                <li key={issue.key}>
                  <button
                    type="button"
                    onClick={() => issue.nodeId && selectNode(issue.nodeId)}
                    disabled={!issue.nodeId}
                    className="w-full rounded-md border border-failed/25 bg-failed/10 px-3 py-1.5 text-left text-xs text-failed transition-colors duration-150 enabled:hover:bg-failed/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ConfigPanel
          node={selected}
          takenIds={nodes.filter((n) => n.id !== selected?.id).map((n) => n.id)}
          onConfigChange={onConfigChange}
          onRename={onRename}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
