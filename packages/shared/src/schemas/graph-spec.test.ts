import { describe, expect, it } from "vitest";
import {
  GRAPH_SPEC_VERSION,
  activityRegistry,
  blogPostPipelineSpec,
  executionOrder,
  graphSpecSchema,
  type GraphSpecErrorCode,
} from "./graph-spec";

/**
 * The validator is the contract templates and the canvas author against —
 * every structural error code gets a rejecting case asserting the precise
 * error (build-plan Verify: unknown node type, cycle, disconnected node, …).
 * Fixtures are deliberately loose-typed: they exist to exercise invalid input.
 */

interface LooseSpec {
  specVersion: number;
  name: string;
  nodes: { id: string; type: string; config?: Record<string, unknown> }[];
  edges: { from: string; to: string }[];
}

const chain = (): LooseSpec => ({
  specVersion: GRAPH_SPEC_VERSION,
  name: "Test Chain",
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

function errorCodes(value: unknown): GraphSpecErrorCode[] {
  const result = graphSpecSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues
    .map((i) => (i.code === "custom" ? (i.params?.code as GraphSpecErrorCode) : undefined))
    .filter((c): c is GraphSpecErrorCode => c !== undefined);
}

describe("graphSpecSchema", () => {
  it("accepts the canonical blog pipeline chain and applies config defaults", () => {
    const parsed = graphSpecSchema.parse(chain());
    expect(parsed.nodes).toHaveLength(4);
    // .default({}) materializes config on every node.
    for (const node of parsed.nodes) expect(node.config).toEqual({});
  });

  it("accepts a single-node spec with no edges (boundary)", () => {
    const spec: LooseSpec = {
      specVersion: GRAPH_SPEC_VERSION,
      name: "Research only",
      nodes: [{ id: "research", type: "research" }],
      edges: [],
    };
    expect(graphSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("accepts per-node timeout/retry and gate timeout config", () => {
    const spec = chain();
    spec.nodes[0]!.config = { timeoutSeconds: 60, maximumAttempts: 2 };
    spec.nodes[1]!.config = { timeoutHours: 48 };
    const parsed = graphSpecSchema.parse(spec);
    expect(parsed.nodes[0]?.config).toEqual({ timeoutSeconds: 60, maximumAttempts: 2 });
    expect(parsed.nodes[1]?.config).toEqual({ timeoutHours: 48 });
  });

  it("rejects an unknown node type", () => {
    const spec = chain();
    spec.nodes[0]!.type = "summarize";
    expect(graphSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rejects an unknown spec version", () => {
    expect(graphSpecSchema.safeParse({ ...chain(), specVersion: 2 }).success).toBe(false);
  });

  it("rejects out-of-range node config", () => {
    const spec = chain();
    spec.nodes[0]!.config = { maximumAttempts: 11 };
    expect(graphSpecSchema.safeParse(spec).success).toBe(false);
    const gateSpec = chain();
    gateSpec.nodes[1]!.config = { timeoutHours: 0 };
    expect(graphSpecSchema.safeParse(gateSpec).success).toBe(false);
  });

  it("rejects duplicate node ids", () => {
    const spec = chain();
    spec.nodes[1]!.id = "research";
    spec.edges = [{ from: "research", to: "write" }];
    expect(errorCodes(spec)).toContain("duplicate_node_id");
  });

  it("rejects an edge referencing an unknown node", () => {
    const spec = chain();
    spec.edges[2] = { from: "write", to: "nowhere" };
    expect(errorCodes(spec)).toContain("unknown_edge_endpoint");
  });

  it("rejects fan-out (non-sequential edges)", () => {
    const spec = chain();
    spec.edges.push({ from: "research", to: "write" });
    expect(errorCodes(spec)).toContain("non_sequential_edges");
  });

  it("rejects a self-edge as non-sequential fan-in", () => {
    const spec = chain();
    spec.edges.push({ from: "publish", to: "publish" });
    expect(errorCodes(spec)).toContain("non_sequential_edges");
  });

  it("rejects a cycle with no entry point", () => {
    const spec: LooseSpec = {
      specVersion: GRAPH_SPEC_VERSION,
      name: "Loop",
      nodes: [
        { id: "research", type: "research" },
        { id: "approval", type: "approval" },
      ],
      edges: [
        { from: "research", to: "approval" },
        { from: "approval", to: "research" },
      ],
    };
    expect(errorCodes(spec)).toContain("cycle");
  });

  it("rejects a detached cycle beside a valid chain as disconnected nodes", () => {
    const spec: LooseSpec = {
      specVersion: GRAPH_SPEC_VERSION,
      name: "Chain plus loop",
      nodes: [
        { id: "research", type: "research" },
        { id: "approval", type: "approval" },
        { id: "loop-a", type: "write" },
        { id: "loop-b", type: "publish" },
      ],
      edges: [
        { from: "research", to: "approval" },
        { from: "loop-a", to: "loop-b" },
        { from: "loop-b", to: "loop-a" },
      ],
    };
    const codes = errorCodes(spec);
    expect(codes).toContain("disconnected_node");
  });

  it("rejects two separate chains (multiple start nodes)", () => {
    const spec = chain();
    spec.edges = [
      { from: "research", to: "approval" },
      { from: "write", to: "publish" },
    ];
    expect(errorCodes(spec)).toContain("multiple_start_nodes");
  });

  it("rejects an orphan node with no edges at all", () => {
    const spec: LooseSpec = {
      specVersion: GRAPH_SPEC_VERSION,
      name: "Orphan",
      nodes: [
        { id: "research", type: "research" },
        { id: "approval", type: "approval" },
        { id: "orphan", type: "write" },
      ],
      edges: [{ from: "research", to: "approval" }],
    };
    // Both the real start and the orphan lack incoming edges.
    expect(errorCodes(spec)).toContain("multiple_start_nodes");
  });

  it("rejects more than one approval node", () => {
    const spec: LooseSpec = {
      specVersion: GRAPH_SPEC_VERSION,
      name: "Two gates",
      nodes: [
        { id: "research", type: "research" },
        { id: "gate-one", type: "approval" },
        { id: "gate-two", type: "approval" },
        { id: "write", type: "write" },
      ],
      edges: [
        { from: "research", to: "gate-one" },
        { from: "gate-one", to: "gate-two" },
        { from: "gate-two", to: "write" },
      ],
    };
    expect(errorCodes(spec)).toContain("multiple_approval_nodes");
  });

  it("rejects a node consuming a channel no earlier node produces", () => {
    const spec: LooseSpec = {
      specVersion: GRAPH_SPEC_VERSION,
      name: "Write first",
      nodes: [
        { id: "write", type: "write" },
        { id: "publish", type: "publish" },
      ],
      edges: [{ from: "write", to: "publish" }],
    };
    // write consumes "research", produced by nothing before it.
    expect(errorCodes(spec)).toContain("missing_channel");
  });

  it("rejects publish without a draft producer", () => {
    const spec: LooseSpec = {
      specVersion: GRAPH_SPEC_VERSION,
      name: "No draft",
      nodes: [
        { id: "research", type: "research" },
        { id: "publish", type: "publish" },
      ],
      edges: [{ from: "research", to: "publish" }],
    };
    expect(errorCodes(spec)).toContain("missing_channel");
  });

  it("rejects an approval gate before research", () => {
    const spec: LooseSpec = {
      specVersion: GRAPH_SPEC_VERSION,
      name: "Gate first",
      nodes: [
        { id: "approval", type: "approval" },
        { id: "research", type: "research" },
      ],
      edges: [{ from: "approval", to: "research" }],
    };
    expect(errorCodes(spec)).toContain("missing_channel");
  });

  it("carries a human message naming the offending node and channel", () => {
    const spec: LooseSpec = {
      specVersion: GRAPH_SPEC_VERSION,
      name: "Write first",
      nodes: [
        { id: "write", type: "write" },
        { id: "publish", type: "publish" },
      ],
      edges: [{ from: "write", to: "publish" }],
    };
    const result = graphSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join("\n");
      expect(messages).toContain('"write"');
      expect(messages).toContain('"research"');
    }
  });
});

describe("executionOrder", () => {
  it("returns the blog pipeline chain in order", () => {
    expect(executionOrder(blogPostPipelineSpec).map((n) => n.id)).toEqual([
      "research",
      "write",
      "approval",
      "publish",
    ]);
  });

  it("handles a single-node spec", () => {
    const spec = graphSpecSchema.parse({
      specVersion: GRAPH_SPEC_VERSION,
      name: "Research only",
      nodes: [{ id: "research", type: "research" }],
      edges: [],
    });
    expect(executionOrder(spec).map((n) => n.id)).toEqual(["research"]);
  });
});

describe("activityRegistry", () => {
  it("maps every activity node type to a worker activity name", () => {
    expect(activityRegistry.research.activity).toBe("research");
    expect(activityRegistry.write.activity).toBe("writeDraft");
    expect(activityRegistry.publish.activity).toBe("publish");
    expect(activityRegistry.approval.activity).toBeNull();
  });

  it("declares the v1 channel flow", () => {
    expect(activityRegistry.research.produces).toBe("research");
    expect(activityRegistry.approval.consumes).toContain("research");
    expect(activityRegistry.write.consumes).toContain("research");
    expect(activityRegistry.write.produces).toBe("draft");
    expect(activityRegistry.publish.consumes).toContain("draft");
  });
});

describe("blogPostPipelineSpec", () => {
  it("is itself a valid spec (parsed at module load)", () => {
    expect(graphSpecSchema.safeParse(blogPostPipelineSpec).success).toBe(true);
    expect(blogPostPipelineSpec.name).toBe("Blog Post Pipeline");
  });
});
