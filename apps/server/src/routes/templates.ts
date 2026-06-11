import type { FastifyPluginAsync } from "fastify";
import {
  templateCatalog,
  templateKeySchema,
  type TemplateListResponse,
} from "@conductor/shared";
import { activeOrgId } from "../lib/active-org";
import { ensureTemplateDefinition } from "../lib/templates";

/**
 * Workflow Library routes (Unit 26). `GET /templates` lists the curated
 * catalog with each template's pinned org definition row — and IS the seeding
 * trigger: the org's `workflow_definitions` rows are materialized (or rolled
 * forward to a new version when the catalog evolved) on read. Display/form
 * data lives in the client's own catalog import; this endpoint's job is the
 * pinning info.
 */

export function templateRoutes(): FastifyPluginAsync {
  return async (app) => {
    app.get(
      "/templates",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req): Promise<TemplateListResponse> => {
        const orgId = activeOrgId(req);
        const items = [];
        for (const key of templateKeySchema.options) {
          const definition = await ensureTemplateDefinition(orgId, key);
          const template = templateCatalog[key];
          items.push({
            key,
            name: template.name,
            description: template.description,
            definitionId: definition.id,
            version: definition.version,
          });
        }
        return { items };
      },
    );
  };
}
