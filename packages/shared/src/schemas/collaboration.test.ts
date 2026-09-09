import { describe, expect, it } from "vitest";
import {
  applyCanvasOperation,
  canvasDocumentSchema,
  canvasOperationRequestSchema,
} from "./collaboration";

const document = canvasDocumentSchema.parse({
  specVersion: 1,
  name: "Shared draft",
  nodes: [{ id: "research", type: "research" }],
  edges: [],
  positions: { research: { x: 0, y: 0 } },
});

describe("collaboration contracts", () => {
  it("applies domain operations while allowing an incomplete graph", () => {
    const next = applyCanvasOperation(document, {
      type: "add_node",
      node: { id: "write", type: "write", config: {} },
      position: { x: 280, y: 0 },
    });
    const renamed = applyCanvasOperation(next, {
      type: "rename_node",
      id: "write",
      newId: "draft",
    });
    expect(renamed.nodes.map((node) => node.id)).toEqual(["research", "draft"]);
    expect(renamed.positions.draft).toEqual({ x: 280, y: 0 });
  });

  it("rejects malformed operations before they can reach the server", () => {
    expect(
      canvasOperationRequestSchema.safeParse({
        draftId: "not-a-uuid",
        clientOperationId: "also-not-a-uuid",
        baseRevision: -1,
        operation: { type: "move_node", id: "Research", position: { x: Infinity, y: 0 } },
      }).success,
    ).toBe(false);
  });

  it("does not permit duplicate node ids or dangling edge endpoints", () => {
    expect(() =>
      applyCanvasOperation(document, {
        type: "add_node",
        node: { id: "research", type: "research", config: {} },
        position: { x: 1, y: 1 },
      }),
    ).toThrow("already exists");
    expect(() =>
      applyCanvasOperation(document, {
        type: "add_edge",
        edge: { from: "research", to: "missing" },
      }),
    ).toThrow("endpoint");
  });
});
