import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  definitionParametersSchema,
  graphSpecSchema,
  launchDefinitionRunSchema,
  saveDefinitionRequestSchema,
  type DefinitionListResponse,
  type DefinitionResource,
} from "@conductor/shared";
import type { Definition } from "@conductor/db";
import { AppError, NotFoundError, ValidationError } from "../errors";
import { activeOrgId } from "../lib/active-org";
import { repos } from "../repos/index";
import type { RunGateway } from "../temporal";
import { toRunResource } from "./runs";

/**
 * Workflow-definition routes. Unit 30 added the read side (a run's pinned
 * spec); Unit 32 adds save-as-new-version, the version/latest listings, and
 * launching runs from canvas-authored definitions — through the SAME
 * interpreter and run contract as template launches (one execution path).
 */

const idParamSchema = z.object({ id: z.uuid() });

const listQuerySchema = z.object({
  /** Exact name → that definition's full version history (newest first). */
  name: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(100).optional(),
});

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

export function definitionRoutes(temporal?: RunGateway): FastifyPluginAsync {
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

    app.get(
      "/definitions",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req): Promise<DefinitionListResponse> => {
        const orgId = activeOrgId(req);
        const query = listQuerySchema.safeParse(req.query);
        if (!query.success) throw new ValidationError("Invalid list parameters");

        if (query.data.name) {
          // One name's version history — bounded by its version count.
          const versions = await repos.definitions.listDefinitionVersions({
            orgId,
            name: query.data.name,
          });
          return { items: versions.map(toDefinitionResource), nextCursor: null };
        }

        const page = await repos.definitions.listLatestDefinitions({
          orgId,
          limit: query.data.limit,
          cursorName: query.data.cursor,
        });
        return {
          items: page.items.map(toDefinitionResource),
          nextCursor: page.nextCursorName,
        };
      },
    );

    app.post(
      "/definitions",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req, reply) => {
        const orgId = activeOrgId(req);
        // The shared schema validates the graph AND rejects reserved template
        // names — the editor narrates the same rules before ever posting.
        const parsed = saveDefinitionRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ValidationError(`Invalid workflow definition: ${parsed.error.message}`);
        }
        const { graphSpec, description } = parsed.data;

        // Canvas rows carry no templateKey link (parameters: {}) — Unit 32
        // decision 2; the resume route's blog fallback matches the canvas
        // launch contract exactly.
        const definition = await repos.definitions.createDefinitionVersion({
          orgId,
          name: graphSpec.name,
          description,
          graphSpec,
          parameters: {},
        });
        req.log.info(
          {
            event: "canvas.definition_saved",
            orgId,
            definitionId: definition.id,
            name: definition.name,
            version: definition.version,
          },
          "canvas definition saved",
        );
        return reply.code(201).send(toDefinitionResource(definition));
      },
    );

    if (!temporal) return;

    app.post(
      "/definitions/:id/runs",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req, reply) => {
        const orgId = activeOrgId(req);
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) throw new NotFoundError("Workflow definition not found");

        const definition = await repos.definitions.findDefinitionById({
          orgId,
          id: params.data.id,
        });
        if (!definition) throw new NotFoundError("Workflow definition not found");
        const spec = graphSpecSchema.safeParse(definition.graphSpec);
        if (!spec.success) {
          // Pre-spec legacy rows have nothing to execute.
          throw new AppError(
            "This definition has no pipeline to run.",
            "definition_not_runnable",
            409,
          );
        }

        const body = launchDefinitionRunSchema.safeParse(req.body);
        if (!body.success) {
          throw new ValidationError(`Invalid run parameters: ${body.error.message}`);
        }

        // Same pre-create + start + honest-failure contract as POST /runs;
        // the run pins THIS version row and the spec rides inline (Temporal
        // history holds exactly what executed — later versions can't touch it).
        const id = randomUUID();
        const temporalWorkflowId = `run-${id}`;
        const run = await repos.runs.createRun({
          id,
          orgId,
          definitionId: definition.id,
          workflowName: spec.data.name,
          temporalWorkflowId,
          status: "pending",
          input: body.data.params,
        });

        try {
          const { temporalRunId } = await temporal.startInterpreter({
            workflowId: temporalWorkflowId,
            // Canvas launches ride the engine contract via the blog identity
            // mapping (Unit 32 decision 1) — one dispatch path, exact behavior.
            input: {
              orgId,
              templateKey: "blog-post-pipeline",
              spec: spec.data,
              params: body.data.params,
            },
          });
          req.log.info(
            {
              event: "canvas.run_launched",
              orgId,
              definitionId: definition.id,
              runId: id,
            },
            "canvas run launched",
          );
          return reply.code(201).send(toRunResource({ ...run, temporalRunId }));
        } catch (err) {
          req.log.error(
            { err, runId: id, definitionId: definition.id, orgId },
            "canvas workflow start failed",
          );
          await repos.runs.markRunTerminal({
            orgId,
            temporalWorkflowId,
            status: "failed",
            error: "The run could not be started",
          });
          throw new AppError(
            "The run could not be started. Try again.",
            "run_start_failed",
            502,
          );
        }
      },
    );
  };
}
