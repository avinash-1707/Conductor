import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  definitionParametersSchema,
  graphSpecSchema,
  type DefinitionResource,
} from "@conductor/shared";
import type { Definition } from "@conductor/db";
import { NotFoundError } from "../errors";
import { activeOrgId } from "../lib/active-org";
import { repos } from "../repos/index";

/**
 * Workflow-definition routes (Unit 30) — the read side of the immutable
 * `(org, name, version)` rows runs pin. The canvas viewer fetches a run's
 * pinned spec here; Unit 32 adds the write side (save-as-new-version).
 */

const idParamSchema = z.object({ id: z.uuid() });

export function toDefinitionResource(definition: Definition): DefinitionResource {
  // Stored JSONB is parsed on read at the boundary (code-standards Data &
  // Storage); a legacy row without a spec serializes as null, never throws.
  const spec = graphSpecSchema.safeParse(definition.graphSpec);
  const link = definitionParametersSchema.safeParse(definition.parameters);
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description ?? null,
    version: definition.version,
    graphSpec: spec.success ? spec.data : null,
    templateKey: link.success ? link.data.templateKey : null,
    createdAt: definition.createdAt.toISOString(),
  };
}

export function definitionRoutes(): FastifyPluginAsync {
  return async (app) => {
    app.get(
      "/definitions/:id",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req): Promise<DefinitionResource> => {
        const orgId = activeOrgId(req);
        // Non-uuid, unknown, and cross-org ids are the same 404 (tenancy
        // semantics: absence and denial are indistinguishable).
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) throw new NotFoundError("Workflow definition not found");

        const definition = await repos.definitions.findDefinitionById({
          orgId,
          id: params.data.id,
        });
        if (!definition) throw new NotFoundError("Workflow definition not found");
        return toDefinitionResource(definition);
      },
    );
  };
}
