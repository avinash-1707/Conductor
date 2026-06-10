import { z } from "zod";

/**
 * Versioned graph spec (Unit 24) — the single workflow model behind both
 * authoring surfaces (templates now, canvas later; architecture Execution
 * Model: "one engine, two authoring surfaces"). The Unit 25 interpreter walks
 * a validated spec; Unit 26 stores curated specs in `workflow_definitions`.
 *
 * Validation IS the schema (a superRefine), so the server (route/repo
 * boundaries) and the later canvas client mirror one implementation with
 * identical precise errors — never two divergent validators.
 */

/** Spec format version — bump on breaking format changes (like crypto's `v1.`). */
export const GRAPH_SPEC_VERSION = 1;

/**
 * The activity registry: every node type a spec may reference, with the data
 * the validator and interpreter need. Data only — shared never imports worker
 * code; `activity` names are pinned by the worker's exported activities (the
 * same start-by-name convention the server's RunGateway uses).
 *
 * Channels model v1 data flow: a node type `produces` a named value into the
 * run's channel bag and `consumes` channels earlier nodes must have produced.
 * Defaults mirror the hardcoded contentPipeline's proxy options.
 */
export const activityRegistry = {
  research: {
    kind: "activity",
    activity: "research",
    produces: "research",
    consumes: [],
    defaults: { timeoutSeconds: 120, maximumAttempts: 5 },
  },
  approval: {
    kind: "gate",
    activity: null,
    produces: null,
    consumes: ["research"],
    defaults: { timeoutHours: 24 },
  },
  write: {
    kind: "activity",
    activity: "writeDraft",
    produces: "draft",
    consumes: ["research"],
    defaults: { timeoutSeconds: 120, maximumAttempts: 5 },
  },
  publish: {
    kind: "activity",
    activity: "publish",
    produces: null,
    consumes: ["draft"],
    defaults: { timeoutSeconds: 120, maximumAttempts: 5 },
  },
} as const;

export type GraphNodeType = keyof typeof activityRegistry;

export const graphNodeTypeSchema = z.enum(
  Object.keys(activityRegistry) as [GraphNodeType, ...GraphNodeType[]],
);

/** Node ids are short slugs — they appear in errors, payloads, and (later) the canvas. */
const nodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "node id must be a lowercase slug");

/** Per-node execution config for activity nodes (build plan: per-node timeout/retry). */
export const activityNodeConfigSchema = z.object({
  timeoutSeconds: z.number().int().min(1).max(600).optional(),
  maximumAttempts: z.number().int().min(1).max(10).optional(),
});
export type ActivityNodeConfig = z.infer<typeof activityNodeConfigSchema>;

/** Gate config: how long reviewers get before the run expires (default 24h). */
export const approvalNodeConfigSchema = z.object({
  timeoutHours: z.number().int().min(1).max(168).optional(),
});
export type ApprovalNodeConfig = z.infer<typeof approvalNodeConfigSchema>;

export const graphNodeSchema = z.discriminatedUnion("type", [
  z.object({
    id: nodeIdSchema,
    type: z.literal("research"),
    config: activityNodeConfigSchema.default({}),
  }),
  z.object({
    id: nodeIdSchema,
    type: z.literal("approval"),
    config: approvalNodeConfigSchema.default({}),
  }),
  z.object({
    id: nodeIdSchema,
    type: z.literal("write"),
    config: activityNodeConfigSchema.default({}),
  }),
  z.object({
    id: nodeIdSchema,
    type: z.literal("publish"),
    config: activityNodeConfigSchema.default({}),
  }),
]);
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  from: nodeIdSchema,
  to: nodeIdSchema,
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

/**
 * Structural validation codes — stable identifiers tests, the server, and the
 * canvas key error UI off. Every issue also carries a human message naming
 * the offending node/edge ("precise errors", build-plan Verify line).
 */
export type GraphSpecErrorCode =
  | "duplicate_node_id"
  | "unknown_edge_endpoint"
  | "non_sequential_edges"
  | "cycle"
  | "multiple_start_nodes"
  | "disconnected_node"
  | "multiple_approval_nodes"
  | "missing_channel";

interface GraphShape {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function issue(
  ctx: z.core.$RefinementCtx,
  code: GraphSpecErrorCode,
  message: string,
  path: (string | number)[],
): void {
  ctx.addIssue({ code: "custom", message, path, params: { code } });
}

/**
 * Walks the chain from the start node. Returns the visited order, or null when
 * no unique start exists (those cases are reported separately).
 */
function walkChain(spec: GraphShape): GraphNode[] | null {
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const next = new Map(spec.edges.map((e) => [e.from, e.to]));
  const hasIncoming = new Set(spec.edges.map((e) => e.to));
  const starts = spec.nodes.filter((n) => !hasIncoming.has(n.id));
  if (starts.length !== 1) return null;

  const order: GraphNode[] = [];
  const seen = new Set<string>();
  let current: string | undefined = starts[0]!.id;
  while (current !== undefined) {
    if (seen.has(current)) return order; // cycle — reported by the caller
    const node = byId.get(current);
    if (!node) return order; // dangling edge — reported by unknown_edge_endpoint
    seen.add(current);
    order.push(node);
    current = next.get(current);
  }
  return order;
}

function validateGraph(spec: GraphShape, ctx: z.core.$RefinementCtx): void {
  const ids = new Set<string>();
  spec.nodes.forEach((node, i) => {
    if (ids.has(node.id)) {
      issue(ctx, "duplicate_node_id", `duplicate node id "${node.id}"`, ["nodes", i, "id"]);
    }
    ids.add(node.id);
  });

  let endpointsValid = true;
  spec.edges.forEach((edge, i) => {
    for (const end of ["from", "to"] as const) {
      if (!ids.has(edge[end])) {
        endpointsValid = false;
        issue(
          ctx,
          "unknown_edge_endpoint",
          `edge ${end} references unknown node "${edge[end]}"`,
          ["edges", i, end],
        );
      }
    }
  });
  // Structural checks below assume edges point at real nodes.
  if (!endpointsValid) return;

  // Sequential v1: at most one outgoing and one incoming edge per node.
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();
  for (const edge of spec.edges) {
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  let sequential = true;
  for (const node of spec.nodes) {
    if ((outgoing.get(node.id) ?? 0) > 1 || (incoming.get(node.id) ?? 0) > 1) {
      sequential = false;
      issue(
        ctx,
        "non_sequential_edges",
        `node "${node.id}" has multiple incoming or outgoing edges — v1 graphs are a single sequential chain`,
        ["edges"],
      );
    }
  }
  if (!sequential) return;

  const starts = spec.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0);
  if (starts.length === 0) {
    // With at most one incoming/outgoing edge per node, "every node has an
    // incoming edge" is exactly a cycle — there is no entry point.
    issue(ctx, "cycle", "the graph is a cycle — every node has an incoming edge", ["edges"]);
    return;
  }
  if (starts.length > 1) {
    issue(
      ctx,
      "multiple_start_nodes",
      `multiple start nodes (${starts.map((n) => `"${n.id}"`).join(", ")}) — the graph is disconnected`,
      ["edges"],
    );
    return;
  }

  const order = walkChain(spec);
  if (order === null) return; // unreachable: start-node cases handled above
  if (order.length < spec.nodes.length) {
    // Nodes the chain never reaches — e.g. a detached cycle alongside a valid
    // chain (any cycle reachable FROM the chain would be fan-in, caught above).
    const visited = new Set(order.map((n) => n.id));
    for (const orphan of spec.nodes.filter((n) => !visited.has(n.id))) {
      issue(
        ctx,
        "disconnected_node",
        `node "${orphan.id}" is not reachable from the start node`,
        ["nodes", spec.nodes.indexOf(orphan)],
      );
    }
    return;
  }

  const approvals = spec.nodes.filter((n) => n.type === "approval");
  if (approvals.length > 1) {
    issue(
      ctx,
      "multiple_approval_nodes",
      "more than one approval node — v1 runs have one gate (unique approval per run)",
      ["nodes"],
    );
  }

  // Data flow: every consumed channel must be produced by an earlier node.
  const produced = new Set<string>();
  for (const node of order) {
    const entry = activityRegistry[node.type];
    for (const channel of entry.consumes) {
      if (!produced.has(channel)) {
        issue(
          ctx,
          "missing_channel",
          `node "${node.id}" (${node.type}) consumes "${channel}", which no earlier node produces`,
          ["nodes", spec.nodes.indexOf(node)],
        );
      }
    }
    if (entry.produces) produced.add(entry.produces);
  }
}

export const graphSpecSchema = z
  .object({
    specVersion: z.literal(GRAPH_SPEC_VERSION),
    name: z.string().min(1).max(100),
    nodes: z.array(graphNodeSchema).min(1).max(20),
    edges: z.array(graphEdgeSchema).max(40),
  })
  .superRefine(validateGraph);
export type GraphSpec = z.infer<typeof graphSpecSchema>;

/**
 * The nodes in chain order (start → end). Pure and deterministic — safe in the
 * workflow sandbox; only call with a spec that already passed graphSpecSchema.
 */
export function executionOrder(spec: GraphSpec): GraphNode[] {
  const order = walkChain(spec);
  if (order === null || order.length !== spec.nodes.length) {
    throw new Error("executionOrder requires a validated graph spec");
  }
  return order;
}

/**
 * The canonical Blog Post Pipeline as a graph spec — must stay behaviorally
 * identical to the hardcoded contentPipeline (Unit 25 proves it; Unit 26
 * seeds the curated template from it and retires the hardcoded workflow).
 */
export const blogPostPipelineSpec: GraphSpec = graphSpecSchema.parse({
  specVersion: GRAPH_SPEC_VERSION,
  name: "Blog Post Pipeline",
  nodes: [
    { id: "research", type: "research" },
    { id: "approval", type: "approval" },
    { id: "write", type: "write" },
    { id: "publish", type: "publish" },
  ],
  edges: [
    { from: "research", to: "approval" },
    { from: "approval", to: "write" },
    { from: "write", to: "publish" },
  ],
});
