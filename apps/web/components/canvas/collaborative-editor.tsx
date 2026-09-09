"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type Connection, type Edge, type NodeChange } from "@xyflow/react";
import {
  AlertCircle,
  AlertTriangle,
  CircleCheck,
  CloudOff,
  Radio,
  Rocket,
  Save,
  WifiOff,
} from "lucide-react";
import {
  applyCanvasOperation,
  blogPostPipelineInputSchema,
  canvasOperationSchema,
  templateCatalog,
  type BlogPostPipelineInput,
  type CanvasDocument,
  type CanvasDraftResource,
  type CanvasOperation,
  type CanvasOperationApplied,
  type DefinitionResource,
  type GraphNode,
  type GraphNodeType,
} from "@conductor/shared";
import { api, ApiError } from "@/lib/api";
import { Button, Input, Label, Spinner } from "@/components/app/ui";
import { Modal } from "@/components/app/modal";
import { ParamsForm } from "@/components/app/params-form";
import { useToast } from "@/components/app/toast";
import { useCanvasEvents } from "@/lib/use-canvas-events";
import { X_GAP, type SpecFlowNode } from "./layout";
import { chainTail, makeEditorNode, nextNodeId, validateEditor } from "./editor-state";
import { NodePalette } from "./node-palette";
import { EditorCanvas } from "./editor-canvas";
import { ConfigPanel } from "./config-panel";

type Position = { x: number; y: number };

function operationsEqual(a: CanvasOperation, b: CanvasOperation): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function documentGraph(
  document: CanvasDocument,
  selectedId: string | null,
  transientPositions: Map<string, Position>,
): { nodes: SpecFlowNode[]; edges: Edge[] } {
  return {
    nodes: document.nodes.map((node) => ({
      id: node.id,
      type: "spec",
      position: transientPositions.get(node.id) ?? document.positions[node.id] ?? { x: 0, y: 0 },
      selected: node.id === selectedId,
      data: { node },
    })),
    edges: document.edges.map((edge) => ({
      id: `${edge.from}->${edge.to}`,
      source: edge.from,
      target: edge.to,
    })),
  };
}

function ConnectionChip({ status }: { status: "live" | "reconnecting" | "offline" }) {
  const tone =
    status === "live"
      ? "border-completed/25 bg-completed/10 text-completed"
      : status === "reconnecting"
        ? "border-suspended/25 bg-suspended/10 text-suspended"
        : "border-failed/25 bg-failed/10 text-failed";
  const Icon = status === "live" ? Radio : status === "reconnecting" ? CloudOff : WifiOff;
  const label = status === "live" ? "Live" : status === "reconnecting" ? "Reconnecting" : "Offline";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs ${tone}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

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

/**
 * A revisioned canvas projection: confirmed server state is reduced through a
 * serialized local operation queue. The queue makes the server's echo safe and
 * provides a clean rebase point when another editor wins a revision race.
 */
export function CollaborativeEditor({ draftId }: { draftId: string }) {
  const { toast } = useToast();
  const [confirmed, setConfirmed] = useState<CanvasDraftResource | null>(null);
  const confirmedRef = useRef<CanvasDraftResource | null>(null);
  const [pendingOperations, setPendingOperations] = useState<CanvasOperation[]>([]);
  const pendingRef = useRef<CanvasOperation[]>([]);
  const inFlightRef = useRef<CanvasOperation | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transientPositions, setTransientPositions] = useState(new Map<string, Position>());
  const [notice, setNotice] = useState<string | null>(null);
  const [writeDenied, setWriteDenied] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [savedDefinition, setSavedDefinition] = useState<DefinitionResource | null>(null);

  const draftQuery = useQuery({
    queryKey: ["canvas-draft", draftId],
    queryFn: () => api.canvasDrafts.get(draftId),
  });

  const replaceConfirmed = useCallback((draft: CanvasDraftResource) => {
    confirmedRef.current = draft;
    let document = draft.document;
    const rebased: CanvasOperation[] = [];
    let dropped = false;
    for (const operation of pendingRef.current) {
      try {
        document = applyCanvasOperation(document, operation);
        rebased.push(operation);
      } catch {
        dropped = true;
      }
    }
    pendingRef.current = rebased;
    setPendingOperations(rebased);
    setConfirmed(draft);
    if (dropped)
      setNotice("A conflicting edit could not be reapplied. You are viewing the latest draft.");
  }, []);

  const refreshDraft = useCallback(async () => {
    try {
      replaceConfirmed(await api.canvasDrafts.get(draftId));
    } catch {
      setNotice("Could not load the latest draft. Reconnect and try again.");
    }
  }, [draftId, replaceConfirmed]);

  useEffect(() => {
    if (draftQuery.data && !confirmedRef.current) replaceConfirmed(draftQuery.data);
  }, [draftQuery.data, replaceConfirmed]);

  const onOperationApplied = useCallback(
    (event: CanvasOperationApplied) => {
      const current = confirmedRef.current;
      if (!current || event.revision <= current.revision) return;
      if (event.revision !== current.revision + 1) {
        void refreshDraft();
        return;
      }

      // The server broadcasts to the author too. Its acknowledgement normally
      // arrives first, but this guard also handles the inverse packet order.
      if (pendingRef.current[0] && operationsEqual(pendingRef.current[0], event.operation)) {
        pendingRef.current = pendingRef.current.slice(1);
        setPendingOperations(pendingRef.current);
      }
      try {
        replaceConfirmed({
          ...current,
          document: applyCanvasOperation(current.document, event.operation),
          revision: event.revision,
        });
      } catch {
        void refreshDraft();
      }
    },
    [refreshDraft, replaceConfirmed],
  );

  const onJoin = useCallback(
    (response: { ok: true; draft: CanvasDraftResource } | { ok: false; code: string }) => {
      if (response.ok) {
        replaceConfirmed(response.draft);
        return;
      }
      setNotice(
        response.code === "forbidden"
          ? "You do not have access to this draft."
          : "This draft is no longer available.",
      );
    },
    [replaceConfirmed],
  );

  const { status: socketStatus, sendOperation: sendCanvasOperation } = useCanvasEvents(
    draftId,
    onOperationApplied,
    onJoin,
  );

  const document = useMemo(() => {
    if (!confirmed) return null;
    return pendingOperations.reduce(
      (next, operation) => applyCanvasOperation(next, operation),
      confirmed.document,
    );
  }, [confirmed, pendingOperations]);

  const collaborationStatus =
    socketStatus === "live" ? "live" : socketStatus === "offline" ? "offline" : "reconnecting";
  const readOnly = !document || collaborationStatus !== "live" || writeDenied;

  const queueOperation = useCallback(
    (operation: CanvasOperation) => {
      if (readOnly) {
        setNotice(
          writeDenied
            ? "Only organization owners can edit this draft."
            : "Reconnect before editing the draft.",
        );
        return;
      }
      const base = confirmedRef.current;
      if (!base) return;
      try {
        let preview = base.document;
        for (const queued of pendingRef.current) preview = applyCanvasOperation(preview, queued);
        applyCanvasOperation(preview, operation);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "This change could not be applied.");
        return;
      }
      const next = [...pendingRef.current, canvasOperationSchema.parse(operation)];
      pendingRef.current = next;
      setPendingOperations(next);
    },
    [readOnly, writeDenied],
  );

  useEffect(() => {
    const current = confirmedRef.current;
    const operation = pendingRef.current[0];
    if (
      !current ||
      !operation ||
      inFlightRef.current ||
      collaborationStatus !== "live" ||
      writeDenied
    )
      return;

    inFlightRef.current = operation;
    void sendCanvasOperation({
      draftId,
      clientOperationId: crypto.randomUUID(),
      baseRevision: current.revision,
      operation,
    })
      .then((response) => {
        if (response.ok) {
          if (pendingRef.current[0] === operation) {
            pendingRef.current = pendingRef.current.slice(1);
            setPendingOperations(pendingRef.current);
          }
          const latest = confirmedRef.current;
          if (!latest || response.revision <= latest.revision) return;
          if (response.revision !== latest.revision + 1) {
            void refreshDraft();
            return;
          }
          replaceConfirmed({
            ...latest,
            document: applyCanvasOperation(latest.document, response.operation),
            revision: response.revision,
          });
          return;
        }
        if (response.code === "stale_revision") {
          setNotice(
            "Another editor changed this draft. Your pending edit was rebased on the latest revision.",
          );
          replaceConfirmed(response.draft);
          return;
        }
        if (pendingRef.current[0] === operation) {
          pendingRef.current = pendingRef.current.slice(1);
          setPendingOperations(pendingRef.current);
        }
        if (response.code === "forbidden") {
          setWriteDenied(true);
          setNotice("Only organization owners can edit this draft.");
        } else {
          setNotice("This change was not accepted by the collaboration server.");
        }
      })
      .catch(() => {
        if (pendingRef.current[0] === operation) {
          pendingRef.current = pendingRef.current.slice(1);
          setPendingOperations(pendingRef.current);
        }
        setNotice("This change could not be sent. Reconnect and try again.");
        // An acknowledgement timeout is indeterminate: replace local state from
        // Postgres before allowing a user to attempt another edit.
        void refreshDraft();
      })
      .finally(() => {
        inFlightRef.current = null;
      });
  }, [
    collaborationStatus,
    confirmed,
    draftId,
    pendingOperations,
    refreshDraft,
    replaceConfirmed,
    sendCanvasOperation,
    writeDenied,
  ]);

  const graph = useMemo(
    () =>
      document ? documentGraph(document, selectedId, transientPositions) : { nodes: [], edges: [] },
    [document, selectedId, transientPositions],
  );
  const validation = useMemo(
    () => validateEditor(document?.name ?? "", graph.nodes, graph.edges),
    [document?.name, graph.edges, graph.nodes],
  );
  const invalidIds = useMemo(
    () => new Set(validation.issues.flatMap((issue) => (issue.nodeId ? [issue.nodeId] : []))),
    [validation.issues],
  );
  const decoratedNodes = useMemo(
    () =>
      graph.nodes.map((node) =>
        invalidIds.has(node.id) ? { ...node, data: { ...node.data, invalid: true } } : node,
      ),
    [graph.nodes, invalidIds],
  );

  const isDirty = Boolean(
    confirmed && (confirmed.savedRevision !== confirmed.revision || pendingOperations.length > 0),
  );
  const saveDraft = useMutation({
    mutationFn: (revision: number) => api.canvasDrafts.save(draftId, revision),
    onSuccess: (definition, revision) => {
      setSavedDefinition(definition);
      const current = confirmedRef.current;
      if (current) {
        replaceConfirmed({
          ...current,
          savedDefinitionId: definition.id,
          savedRevision: revision,
        });
      }
      toast(`Saved v${definition.version}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "forbidden") setWriteDenied(true);
      setNotice(error instanceof ApiError ? error.message : "The workflow could not be saved.");
    },
  });
  const savedDefinitionQuery = useQuery({
    queryKey: ["definition", confirmed?.savedDefinitionId],
    enabled: Boolean(confirmed?.savedDefinitionId),
    queryFn: () => {
      const id = confirmed?.savedDefinitionId;
      if (!id) throw new Error("No saved definition");
      return api.definitions.get(id);
    },
  });
  const launchDefinition = savedDefinition ?? savedDefinitionQuery.data ?? null;
  const launch = useMutation({
    mutationFn: (params: BlogPostPipelineInput) =>
      api.definitions.launchRun(launchDefinition!.id, params),
    onSuccess: (run) => {
      setLaunchOpen(false);
      window.location.assign(`/runs/${run.id}`);
    },
    onError: (error) => {
      setNotice(error instanceof ApiError ? error.message : "The run could not be started.");
    },
  });

  const onNodesChange = useCallback(
    (changes: NodeChange<SpecFlowNode>[]) => {
      for (const change of changes) {
        if (change.type === "select") {
          if (change.selected) setSelectedId(change.id);
          continue;
        }
        if (change.type === "position" && change.position) {
          const position = change.position;
          setTransientPositions((previous) => new Map(previous).set(change.id, position));
          if (!change.dragging) {
            queueOperation({ type: "move_node", id: change.id, position });
            setTransientPositions((previous) => {
              const next = new Map(previous);
              next.delete(change.id);
              return next;
            });
          }
        }
      }
    },
    [queueOperation],
  );

  const addToChain = useCallback(
    (type: GraphNodeType) => {
      if (!document) return;
      const id = nextNodeId(type, graph.nodes);
      const tail = chainTail(graph.nodes, graph.edges);
      const maxX = graph.nodes.reduce((max, node) => Math.max(max, node.position.x), -X_GAP);
      const position = { x: maxX + X_GAP, y: 0 };
      queueOperation({
        type: "add_node",
        node: makeEditorNode(type, id, position).data.node,
        position,
      });
      if (tail) queueOperation({ type: "add_edge", edge: { from: tail, to: id } });
      setFitSignal((signal) => signal + 1);
    },
    [document, graph.edges, graph.nodes, queueOperation],
  );

  const onDropNode = useCallback(
    (type: GraphNodeType, position: Position) => {
      if (!document) return;
      const id = nextNodeId(type, graph.nodes);
      queueOperation({
        type: "add_node",
        node: makeEditorNode(type, id, position).data.node,
        position,
      });
    },
    [document, graph.nodes, queueOperation],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      queueOperation({
        type: "add_edge",
        edge: { from: connection.source, to: connection.target },
      });
    },
    [queueOperation],
  );

  const selected = decoratedNodes.find((node) => node.id === selectedId) ?? null;
  const canSave = Boolean(
    confirmed &&
    validation.spec &&
    isDirty &&
    pendingOperations.length === 0 &&
    !readOnly &&
    !saveDraft.isPending,
  );
  const canLaunch = Boolean(
    launchDefinition &&
    confirmed?.savedRevision === confirmed?.revision &&
    pendingOperations.length === 0,
  );

  if (draftQuery.isPending && !document) {
    return (
      <div className="grid min-h-[420px] place-items-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (draftQuery.isError && !document) {
    return (
      <p className="rounded-md border border-failed/25 bg-failed/10 px-3 py-2 text-sm text-failed">
        The canvas draft could not be loaded.
      </p>
    );
  }
  if (!document) return null;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="workflow-name">Workflow name</Label>
            <Input
              id="workflow-name"
              key={document.name}
              defaultValue={document.name}
              disabled={readOnly}
              onBlur={(event) => {
                if (event.currentTarget.value !== document.name) {
                  queueOperation({ type: "set_name", name: event.currentTarget.value });
                }
              }}
              maxLength={100}
              className="w-64 max-w-full"
            />
          </div>
          <ValidationChip issueCount={validation.issues.length} />
          <ConnectionChip status={collaborationStatus} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="md"
            disabled={!canSave}
            onClick={() => confirmed && saveDraft.mutate(confirmed.revision)}
          >
            {saveDraft.isPending ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <Save className="h-4 w-4" aria-hidden />
            )}
            {isDirty ? "Save draft" : confirmed?.savedRevision !== null ? "Saved" : "Save draft"}
          </Button>
          <Button
            variant="ghost"
            size="md"
            disabled={!canLaunch}
            title={
              canLaunch ? "Launch a run from the saved version" : "Save the latest draft to launch"
            }
            onClick={() => setLaunchOpen(true)}
          >
            <Rocket className="h-4 w-4 text-accent" aria-hidden />
            Launch
          </Button>
        </div>
      </div>

      {notice && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-suspended/25 bg-suspended/10 px-3 py-2 text-xs text-suspended"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <p>{notice}</p>
        </div>
      )}
      {readOnly && !writeDenied && (
        <p className="text-xs text-muted">
          This canvas is read-only until the collaboration connection is live.
        </p>
      )}
      {writeDenied && (
        <p className="text-xs text-muted">
          You can view this shared draft, but only organization owners can edit it.
        </p>
      )}
      {isDirty && !notice && (
        <p className="text-xs text-muted">
          Unsaved changes — save the current revision to launch it.
        </p>
      )}

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[14rem_1fr_18rem]">
        <NodePalette onAdd={addToChain} readOnly={readOnly} />
        <div className="flex min-h-[420px] flex-col gap-3 lg:h-[calc(100vh-17rem)]">
          <EditorCanvas
            nodes={decoratedNodes}
            edges={graph.edges}
            onNodesChange={onNodesChange}
            onEdgesChange={() => undefined}
            onConnect={onConnect}
            onDropNode={onDropNode}
            onNodesDelete={(nodes) => {
              for (const node of nodes) queueOperation({ type: "delete_node", id: node.id });
              setSelectedId(null);
            }}
            onEdgesDelete={(edges) => {
              for (const edge of edges) {
                if (
                  document.edges.some(
                    (candidate) => candidate.from === edge.source && candidate.to === edge.target,
                  )
                ) {
                  queueOperation({
                    type: "delete_edge",
                    edge: { from: edge.source, to: edge.target },
                  });
                }
              }
            }}
            readOnly={readOnly}
            fitSignal={fitSignal}
          />
          {validation.issues.length > 0 && graph.nodes.length > 0 && (
            <ul className="flex flex-col gap-1" aria-label="Validation issues">
              {validation.issues.map((issue) => (
                <li key={issue.key}>
                  <button
                    type="button"
                    disabled={!issue.nodeId}
                    onClick={() => issue.nodeId && setSelectedId(issue.nodeId)}
                    className="w-full rounded-md border border-failed/25 bg-failed/10 px-3 py-1.5 text-left text-xs text-failed transition-colors duration-150 enabled:hover:bg-failed/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default"
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
          takenIds={graph.nodes.filter((node) => node.id !== selected?.id).map((node) => node.id)}
          readOnly={readOnly}
          onConfigChange={(id, config) => {
            const node = document.nodes.find((candidate) => candidate.id === id);
            if (node)
              queueOperation({
                type: "update_node_config",
                node: { ...node, config } as GraphNode,
              });
          }}
          onRename={(id, newId) => queueOperation({ type: "rename_node", id, newId })}
          onDelete={(id) => {
            queueOperation({ type: "delete_node", id });
            setSelectedId(null);
          }}
        />
      </div>

      {launchOpen && launchDefinition && (
        <Modal
          title={`Launch ${launchDefinition.name} · v${launchDefinition.version}`}
          onClose={() => setLaunchOpen(false)}
        >
          <ParamsForm
            fields={templateCatalog["blog-post-pipeline"].fields}
            schema={blogPostPipelineInputSchema}
            submitLabel="Launch run"
            pending={launch.isPending}
            onSubmit={(params) => launch.mutate(blogPostPipelineInputSchema.parse(params))}
          />
        </Modal>
      )}
    </div>
  );
}
