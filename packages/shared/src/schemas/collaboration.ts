import { z } from "zod";
import {
  GRAPH_SPEC_VERSION,
  graphEdgeSchema,
  graphNodeSchema,
  graphSpecSchema,
} from "./graph-spec";

const nodeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const nameSchema = z.string().min(1).max(100);
const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

/** The editable form of a graph. It deliberately permits invalid intermediate graphs. */
export const canvasDocumentSchema = z.object({
  specVersion: z.literal(GRAPH_SPEC_VERSION),
  name: nameSchema,
  nodes: z.array(graphNodeSchema).max(20),
  edges: z.array(graphEdgeSchema).max(40),
  positions: z.record(nodeIdSchema, positionSchema),
});
export type CanvasDocument = z.infer<typeof canvasDocumentSchema>;

export const canvasOperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_name"), name: nameSchema }),
  z.object({ type: z.literal("add_node"), node: graphNodeSchema, position: positionSchema }),
  z.object({ type: z.literal("move_node"), id: nodeIdSchema, position: positionSchema }),
  z.object({ type: z.literal("update_node_config"), node: graphNodeSchema }),
  z.object({ type: z.literal("rename_node"), id: nodeIdSchema, newId: nodeIdSchema }),
  z.object({ type: z.literal("delete_node"), id: nodeIdSchema }),
  z.object({ type: z.literal("add_edge"), edge: graphEdgeSchema }),
  z.object({ type: z.literal("delete_edge"), edge: graphEdgeSchema }),
]);
export type CanvasOperation = z.infer<typeof canvasOperationSchema>;

function hasNode(document: CanvasDocument, id: string): boolean {
  return document.nodes.some((node) => node.id === id);
}

/** Applies one intentional editor action while preserving an editable, possibly invalid graph. */
export function applyCanvasOperation(
  document: CanvasDocument,
  operation: CanvasOperation,
): CanvasDocument {
  const next = structuredClone(document);
  switch (operation.type) {
    case "set_name":
      next.name = operation.name;
      break;
    case "add_node":
      if (hasNode(next, operation.node.id)) throw new Error("A node with that id already exists");
      next.nodes.push(operation.node);
      next.positions[operation.node.id] = operation.position;
      break;
    case "move_node":
      if (!hasNode(next, operation.id)) throw new Error("Node not found");
      next.positions[operation.id] = operation.position;
      break;
    case "update_node_config": {
      const index = next.nodes.findIndex((node) => node.id === operation.node.id);
      if (index < 0) throw new Error("Node not found");
      next.nodes[index] = operation.node;
      break;
    }
    case "rename_node": {
      if (!hasNode(next, operation.id)) throw new Error("Node not found");
      if (hasNode(next, operation.newId)) throw new Error("A node with that id already exists");
      next.nodes = next.nodes.map((node) =>
        node.id === operation.id ? { ...node, id: operation.newId } : node,
      ) as CanvasDocument["nodes"];
      next.edges = next.edges.map((edge) => ({
        from: edge.from === operation.id ? operation.newId : edge.from,
        to: edge.to === operation.id ? operation.newId : edge.to,
      }));
      const position = next.positions[operation.id];
      delete next.positions[operation.id];
      if (position) next.positions[operation.newId] = position;
      break;
    }
    case "delete_node":
      if (!hasNode(next, operation.id)) throw new Error("Node not found");
      next.nodes = next.nodes.filter((node) => node.id !== operation.id);
      next.edges = next.edges.filter(
        (edge) => edge.from !== operation.id && edge.to !== operation.id,
      );
      delete next.positions[operation.id];
      break;
    case "add_edge":
      if (!hasNode(next, operation.edge.from) || !hasNode(next, operation.edge.to)) {
        throw new Error("Edge endpoint not found");
      }
      if (
        next.edges.some(
          (edge) => edge.from === operation.edge.from && edge.to === operation.edge.to,
        )
      ) {
        throw new Error("That edge already exists");
      }
      next.edges.push(operation.edge);
      break;
    case "delete_edge":
      next.edges = next.edges.filter(
        (edge) => edge.from !== operation.edge.from || edge.to !== operation.edge.to,
      );
      break;
  }
  return canvasDocumentSchema.parse(next);
}

export function canvasDocumentToGraphSpec(document: CanvasDocument) {
  return graphSpecSchema.parse({
    specVersion: document.specVersion,
    name: document.name,
    nodes: document.nodes,
    edges: document.edges,
  });
}

export const canvasDraftResourceSchema = z.object({
  id: z.uuid(),
  sourceDefinitionId: z.uuid().nullable(),
  document: canvasDocumentSchema,
  revision: z.number().int().nonnegative(),
  savedDefinitionId: z.uuid().nullable(),
  savedRevision: z.number().int().nonnegative().nullable(),
  closedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type CanvasDraftResource = z.infer<typeof canvasDraftResourceSchema>;

export const createCanvasDraftRequestSchema = z.object({ sourceDefinitionId: z.uuid().optional() });
export const saveCanvasDraftRequestSchema = z.object({ revision: z.number().int().nonnegative() });
export const canvasJoinRequestSchema = z.object({ draftId: z.uuid() });
export const canvasOperationRequestSchema = z.object({
  draftId: z.uuid(),
  clientOperationId: z.uuid(),
  baseRevision: z.number().int().nonnegative(),
  operation: canvasOperationSchema,
});
export type CanvasOperationRequest = z.infer<typeof canvasOperationRequestSchema>;

export const canvasOperationAppliedSchema = z.object({
  draftId: z.uuid(),
  revision: z.number().int().positive(),
  operation: canvasOperationSchema,
});
export type CanvasOperationApplied = z.infer<typeof canvasOperationAppliedSchema>;

export const canvasJoinResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), draft: canvasDraftResourceSchema }),
  z.object({ ok: z.literal(false), code: z.enum(["not_found", "forbidden", "bad_request"]) }),
]);
export const canvasOperationResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    revision: z.number().int().positive(),
    operation: canvasOperationSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: z.literal("stale_revision"),
    draft: canvasDraftResourceSchema,
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(["not_found", "forbidden", "bad_request", "closed"]),
  }),
]);
