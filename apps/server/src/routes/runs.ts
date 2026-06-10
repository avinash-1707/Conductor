import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  blogPostPipelineInputSchema,
  type RunResource,
  type RunStepResource,
} from "@conductor/shared";
import type { Run, RunCursor, Step } from "@conductor/db";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { repos } from "../repos/index";
import type { RunStarter } from "../temporal";

/**
 * Run lifecycle routes (Unit 13). Handlers validate, authorize, touch the
 * org-scoped repos, and start workflows via the injected Temporal client —
 * nothing long-lived (invariant 10). The org id always comes from the verified
 * JWT claims (invariant 11); cross-org and unknown ids are the same 404.
 */

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

const idParamSchema = z.object({ id: z.uuid() });

/** Opaque list cursor: base64url JSON of the keyset position. */
const cursorPayloadSchema = z.object({ c: z.iso.datetime(), i: z.uuid() });

function encodeCursor(cursor: RunCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt.toISOString(), i: cursor.id }),
  ).toString("base64url");
}

function decodeCursor(raw: string): RunCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid cursor");
  }
  const payload = cursorPayloadSchema.safeParse(parsed);
  if (!payload.success) throw new ValidationError("Invalid cursor");
  return { createdAt: new Date(payload.data.c), id: payload.data.i };
}

function toRunResource(run: Run): RunResource {
  return {
    id: run.id,
    workflowName: run.workflowName,
    temporalWorkflowId: run.temporalWorkflowId,
    temporalRunId: run.temporalRunId,
    status: run.status,
    input: run.input,
    output: run.output,
    error: run.error,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

function toStepResource(step: Step): RunStepResource {
  return {
    id: step.id,
    stepKind: step.stepKind,
    status: step.status,
    attempt: step.attempt,
    input: step.input ?? null,
    output: step.output ?? null,
    error: step.error,
    startedAt: step.startedAt?.toISOString() ?? null,
    completedAt: step.completedAt?.toISOString() ?? null,
  };
}

function activeOrgId(req: FastifyRequest): string {
  const orgId = req.auth?.activeOrganizationId;
  if (!orgId) throw new ForbiddenError("No active organization");
  return orgId;
}

export function runRoutes(temporal: RunStarter): FastifyPluginAsync {
  return async (app) => {
    app.post(
      "/runs",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req, reply) => {
        const orgId = activeOrgId(req);
        const parsed = blogPostPipelineInputSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ValidationError(`Invalid run parameters: ${parsed.error.message}`);
        }
        const input = parsed.data;

        // Pre-create the pending projection row (the idempotency anchor the
        // worker's recordRunStarted converges on), then start the workflow.
        const id = randomUUID();
        const temporalWorkflowId = `run-${id}`;
        const run = await repos.runs.createRun({
          id,
          orgId,
          workflowName: "contentPipeline",
          temporalWorkflowId,
          status: "pending",
          input,
        });

        try {
          const { temporalRunId } = await temporal.startContentPipeline({
            workflowId: temporalWorkflowId,
            input: { ...input, orgId },
          });
          return reply
            .code(201)
            .send(toRunResource({ ...run, temporalRunId }));
        } catch (err) {
          // Keep the row, mark it failed — honest history beats an orphaned
          // "pending" that never executes.
          req.log.error({ err, runId: id, orgId }, "workflow start failed");
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

    app.get(
      "/runs",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req) => {
        const orgId = activeOrgId(req);
        const query = listQuerySchema.safeParse(req.query);
        if (!query.success) throw new ValidationError("Invalid list parameters");
        const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : undefined;

        const page = await repos.runs.listRuns({
          orgId,
          limit: query.data.limit,
          cursor,
        });
        return {
          items: page.items.map(toRunResource),
          nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
        };
      },
    );

    app.get(
      "/runs/:id",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req) => {
        const orgId = activeOrgId(req);
        // A non-uuid id can never exist — same 404 as an unknown or cross-org
        // id (tenancy semantics: absence and denial are indistinguishable).
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) throw new NotFoundError("Run not found");

        const run = await repos.runs.findRunById({ orgId, id: params.data.id });
        if (!run) throw new NotFoundError("Run not found");
        const steps = await repos.activityLog.listStepsForRun({
          orgId,
          runId: run.id,
        });
        return { run: toRunResource(run), steps: steps.map(toStepResource) };
      },
    );
  };
}
