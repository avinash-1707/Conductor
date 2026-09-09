import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  canvasDocumentToGraphSpec,
  canvasDraftResourceSchema,
  createCanvasDraftRequestSchema,
  GRAPH_SPEC_VERSION,
  saveCanvasDraftRequestSchema,
  saveDefinitionRequestSchema,
  type CanvasDocument,
  type CanvasDraftResource,
} from "@conductor/shared";
import type { CanvasDraft } from "@conductor/db";
import { member } from "@conductor/db";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import { NotFoundError, ValidationError } from "../errors";
import { activeOrgId } from "../lib/active-org";
import { repos } from "../repos";
import { toDefinitionResource } from "./definitions";

const idParamSchema = z.object({ id: z.uuid() });

async function isActiveMember(orgId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1);
  return rows.length === 1;
}

export function toCanvasDraftResource(draft: CanvasDraft): CanvasDraftResource {
  return canvasDraftResourceSchema.parse({
    id: draft.id,
    sourceDefinitionId: draft.sourceDefinitionId,
    document: draft.document,
    revision: draft.revision,
    savedDefinitionId: draft.savedDefinitionId,
    savedRevision: draft.savedRevision,
    closedAt: draft.closedAt?.toISOString() ?? null,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  });
}

/** Durable draft endpoints. Writes are owner-only; members can safely view shared URLs. */
export const canvasDraftRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/canvas-drafts",
    { preHandler: (req, reply) => app.requireOwner(req, reply) },
    async (req, reply): Promise<CanvasDraftResource> => {
      const body = createCanvasDraftRequestSchema.safeParse(req.body);
      if (!body.success) throw new ValidationError("Invalid canvas draft request");
      const orgId = activeOrgId(req);
      const userId = req.auth!.userId;
      let sourceDefinitionId: string | undefined;
      let document: CanvasDocument = {
        specVersion: GRAPH_SPEC_VERSION,
        name: "Untitled workflow",
        nodes: [],
        edges: [],
        positions: {},
      };
      if (body.data.sourceDefinitionId) {
        const source = await repos.definitions.findDefinitionById({
          orgId,
          id: body.data.sourceDefinitionId,
        });
        if (!source?.graphSpec) throw new NotFoundError("Workflow definition not found");
        sourceDefinitionId = source.id;
        document = {
          specVersion: source.graphSpec.specVersion,
          name: source.graphSpec.name,
          nodes: source.graphSpec.nodes,
          edges: source.graphSpec.edges,
          positions: Object.fromEntries(
            source.graphSpec.nodes.map((node, index) => [node.id, { x: index * 280, y: 0 }]),
          ),
        };
      }
      const draft = await repos.canvasDrafts.createDraft({
        orgId,
        userId,
        sourceDefinitionId,
        document,
      });
      return reply.code(201).send(toCanvasDraftResource(draft));
    },
  );

  app.get(
    "/canvas-drafts/:id",
    { preHandler: (req, reply) => app.requireSession(req, reply) },
    async (req): Promise<CanvasDraftResource> => {
      const params = idParamSchema.safeParse(req.params);
      if (!params.success) throw new NotFoundError("Canvas draft not found");
      const orgId = activeOrgId(req);
      if (!(await isActiveMember(orgId, req.auth!.userId))) {
        throw new NotFoundError("Canvas draft not found");
      }
      const draft = await repos.canvasDrafts.findDraftById({
        orgId,
        id: params.data.id,
      });
      if (!draft) throw new NotFoundError("Canvas draft not found");
      return toCanvasDraftResource(draft);
    },
  );

  app.post(
    "/canvas-drafts/:id/save",
    { preHandler: (req, reply) => app.requireOwner(req, reply) },
    async (req, reply) => {
      const params = idParamSchema.safeParse(req.params);
      const body = saveCanvasDraftRequestSchema.safeParse(req.body);
      if (!params.success) throw new NotFoundError("Canvas draft not found");
      if (!body.success) throw new ValidationError("Invalid canvas draft save request");
      const orgId = activeOrgId(req);
      const draft = await repos.canvasDrafts.findDraftById({ orgId, id: params.data.id });
      if (!draft) throw new NotFoundError("Canvas draft not found");
      if (draft.revision !== body.data.revision) {
        throw new ValidationError(
          "This workflow changed while you were editing. Load the latest draft.",
        );
      }
      if (draft.savedRevision === draft.revision && draft.savedDefinitionId) {
        const definition = await repos.definitions.findDefinitionById({
          orgId,
          id: draft.savedDefinitionId,
        });
        if (definition) return toDefinitionResource(definition);
      }
      const graphSpec = canvasDocumentToGraphSpec(draft.document);
      const validSave = saveDefinitionRequestSchema.safeParse({ graphSpec });
      if (!validSave.success)
        throw new ValidationError(`Invalid workflow definition: ${validSave.error.message}`);
      const result = await repos.canvasDrafts.saveDraft({
        orgId,
        draftId: draft.id,
        revision: draft.revision,
      });
      if (result.kind === "not_found") throw new NotFoundError("Canvas draft not found");
      if (result.kind === "stale") {
        throw new ValidationError(
          "This workflow changed while you were editing. Load the latest draft.",
        );
      }
      return reply.code(201).send(toDefinitionResource(result.definition));
    },
  );
};
