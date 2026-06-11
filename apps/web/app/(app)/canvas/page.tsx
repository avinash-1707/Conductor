"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { AlertCircle, CircleCheck, History, Rocket, Save } from "lucide-react";
import {
  blogPostPipelineInputSchema,
  reservedDefinitionNames,
  templateCatalog,
  type BlogPostPipelineInput,
  type DefinitionResource,
  type GraphNode,
  type GraphNodeType,
  type GraphSpec,
} from "@conductor/shared";
import { api, ApiError } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { Button, Input, Label, Spinner } from "@/components/app/ui";
import { useToast } from "@/components/app/toast";
import { Modal } from "@/components/app/modal";
import { ParamsForm } from "@/components/app/params-form";
import { X_GAP, type SpecFlowNode } from "@/components/canvas/layout";
import {
  chainTail,
  editorGraphFromSpec,
  makeEditorNode,
  nextNodeId,
  specsEqual,
  validateEditor,
  withNodeConfig,
  withNodeId,
} from "@/components/canvas/editor-state";
import { NodePalette } from "@/components/canvas/node-palette";
import { EditorCanvas } from "@/components/canvas/editor-canvas";
import { ConfigPanel } from "@/components/canvas/config-panel";

/**
 * The canvas editor (Units 31–32) — draft a graph_spec visually, validate it
 * live with the shared schema (the server's exact validator), save it as a
 * new immutable definition version, browse the version history, and launch
 * runs pinned to a saved version through the same interpreter every template
 * runs on. Versions are immutable: editing a reopened version saves the next.
 */

/** Nodes + edges move together (auto-chained adds, renames, deletes). */
type Graph = { nodes: SpecFlowNode[]; edges: Edge[] };

/** The definition version the editor was last saved to / opened from. */
type SavedVersion = { id: string; name: string; version: number; spec: GraphSpec };

const SELECT_CLASS =
  "h-10 rounded-md border border-line bg-inset px-3 text-sm text-ink transition-colors duration-150 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

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

/** Version history for the open definition — click reopens that version. */
function VersionHistory({
  name,
  currentId,
  onOpen,
}: {
  name: string;
  currentId: string;
  onOpen: (definition: DefinitionResource) => void;
}) {
  const versions = useQuery({
    queryKey: ["definitions", name],
    queryFn: () => api.definitions.list({ name }),
  });

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line-soft bg-surface p-4">
      <h2 className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
        <History className="h-3.5 w-3.5" aria-hidden />
        Versions
      </h2>
      {versions.isPending && (
        <p className="text-xs text-faint">Loading versions…</p>
      )}
      {versions.isError && (
        <p className="text-xs text-failed">The version history couldn&apos;t be loaded.</p>
      )}
      {versions.data && (
        <ul className="flex flex-col gap-1">
          {versions.data.items.map((item) => {
            const current = item.id === currentId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item)}
                  disabled={!item.graphSpec}
                  aria-current={current ? "true" : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    current
                      ? "border-accent/60 bg-raised"
                      : "border-line-soft hover:bg-raised"
                  } disabled:opacity-55`}
                >
                  <span className="font-mono text-xs text-ink">v{item.version}</span>
                  <span className="font-mono text-[10px] text-faint">
                    {relativeTime(item.createdAt)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="border-t border-line-soft pt-2 text-[11px] text-faint">
        Versions are immutable — editing an old one saves the next version.
      </p>
    </div>
  );
}

export default function CanvasPage() {
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [fitSignal, setFitSignal] = useState(0);
  const [saved, setSaved] = useState<SavedVersion | null>(null);
  const [launchOpen, setLaunchOpen] = useState(false);
  const { nodes, edges } = graph;

  const validation = useMemo(
    () => validateEditor(name, nodes, edges),
    [name, nodes, edges],
  );

  // Save-time rule shared with the server schema: template names are reserved.
  const reservedName =
    validation.spec !== null &&
    reservedDefinitionNames.has(validation.spec.name.toLowerCase());

  // Dirty = the canvas no longer matches the saved version (launch is pinned
  // to a version row, so an unsaved canvas has nothing runnable).
  const dirty =
    validation.spec !== null &&
    (saved === null || !specsEqual(validation.spec, saved.spec));

  // Canvas-authored definitions for the Open picker (templates stay in /workflows).
  const definitions = useQuery({
    queryKey: ["definitions"],
    queryFn: () => api.definitions.list(),
  });
  const openable = useMemo(
    () =>
      (definitions.data?.items ?? []).filter(
        (item) => item.templateKey === null && item.graphSpec !== null,
      ),
    [definitions.data],
  );

  const openDefinition = useCallback((definition: DefinitionResource) => {
    if (!definition.graphSpec) return;
    setName(definition.graphSpec.name);
    setGraph(editorGraphFromSpec(definition.graphSpec));
    setSaved({
      id: definition.id,
      name: definition.name,
      version: definition.version,
      spec: definition.graphSpec,
    });
    setFitSignal((n) => n + 1);
  }, []);

  const save = useMutation({
    mutationFn: (spec: GraphSpec) => api.definitions.create({ graphSpec: spec }),
    onSuccess: (definition) => {
      toast(`Saved v${definition.version}`);
      if (definition.graphSpec) {
        setSaved({
          id: definition.id,
          name: definition.name,
          version: definition.version,
          spec: definition.graphSpec,
        });
      }
      void client.invalidateQueries({ queryKey: ["definitions"] });
    },
    onError: (err) => {
      toast(
        err instanceof ApiError ? err.message : "The workflow could not be saved.",
        "error",
      );
    },
  });

  const launch = useMutation({
    mutationFn: (params: BlogPostPipelineInput) =>
      api.definitions.launchRun(saved!.id, params),
    onSuccess: (run) => {
      setLaunchOpen(false);
      toast("Launched");
      router.push(`/runs/${run.id}`);
    },
    onError: (err) => {
      toast(
        err instanceof ApiError
          ? err.message
          : "The run could not be started. Try again.",
        "error",
      );
    },
  });

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

  const canSave = validation.spec !== null && !reservedName && dirty;
  const canLaunch = validation.spec !== null && !dirty && saved !== null;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar: name → spec.name; chip = live verdict; save/open/launch. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="workflow-name">Workflow name</Label>
            <Input
              id="workflow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Research Digest"
              maxLength={100}
              className="w-64 max-w-full"
            />
          </div>
          <ValidationChip issueCount={validation.issues.length} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {openable.length > 0 && (
            <select
              aria-label="Open a saved workflow"
              className={SELECT_CLASS}
              value=""
              onChange={(e) => {
                const definition = openable.find((d) => d.id === e.target.value);
                if (definition) openDefinition(definition);
              }}
            >
              <option value="" disabled>
                Open saved…
              </option>
              {openable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · v{d.version}
                </option>
              ))}
            </select>
          )}
          <Button
            size="md"
            disabled={!canSave || save.isPending}
            onClick={() => validation.spec && save.mutate(validation.spec)}
          >
            {save.isPending ? <Spinner className="h-3.5 w-3.5" /> : <Save className="h-4 w-4" aria-hidden />}
            Save{saved && !dirty ? `d v${saved.version}` : ""}
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={!canLaunch}
            title={canLaunch ? "Launch a run from the saved version" : "Save to launch"}
            onClick={() => setLaunchOpen(true)}
          >
            <Rocket className="h-4 w-4 text-accent" aria-hidden />
            Launch
          </Button>
        </div>
      </div>

      {reservedName && (
        <p className="rounded-md border border-failed/25 bg-failed/10 px-3 py-1.5 text-xs text-failed">
          &quot;{validation.spec?.name}&quot; is a built-in template name — pick
          another name.
        </p>
      )}
      {validation.spec && dirty && !reservedName && (
        <p className="text-xs text-muted">
          Unsaved changes — save to launch{saved ? ` (last saved v${saved.version})` : ""}.
        </p>
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[14rem_1fr_18rem]">
        <NodePalette onAdd={addToChain} />
        <div className="flex min-h-[420px] flex-col gap-3 lg:h-[calc(100vh-17rem)]">
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
        <div className="flex flex-col gap-4">
          <ConfigPanel
            node={selected}
            takenIds={nodes.filter((n) => n.id !== selected?.id).map((n) => n.id)}
            onConfigChange={onConfigChange}
            onRename={onRename}
            onDelete={onDelete}
          />
          {saved && (
            <VersionHistory
              name={saved.name}
              currentId={saved.id}
              onOpen={openDefinition}
            />
          )}
        </div>
      </div>

      {launchOpen && saved && (
        <Modal title={`Launch ${saved.name} · v${saved.version}`} onClose={() => setLaunchOpen(false)}>
          <ParamsForm
            fields={templateCatalog["blog-post-pipeline"].fields}
            schema={blogPostPipelineInputSchema}
            submitLabel="Launch run"
            pending={launch.isPending}
            onSubmit={(params) =>
              launch.mutate(blogPostPipelineInputSchema.parse(params))
            }
          />
        </Modal>
      )}
    </div>
  );
}
