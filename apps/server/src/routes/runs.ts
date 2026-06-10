import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  blogPostPipelineInputSchema,
  type RunResource,
  type RunStepResource,
} from "@conductor/shared";
import type { Run, Step } from "@conductor/db";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { decodeKeysetCursor, encodeKeysetCursor } from "../lib/keyset-cursor";
import { buildResumePlan } from "../lib/resume-plan";
import { repos } from "../repos/index";
import type { RunGateway } from "../temporal";

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
    resumedFromRunId: run.resumedFromRunId,
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

export function runRoutes(temporal: RunGateway): FastifyPluginAsync {
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

    app.post(
      "/runs/:id/resume",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req, reply) => {
        const orgId = activeOrgId(req);
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) throw new NotFoundError("Run not found");

        const prior = await repos.runs.findRunById({ orgId, id: params.data.id });
        if (!prior) throw new NotFoundError("Run not found");
        // Only failed runs are resumable: rejected/expired are human decisions
        // a resume must not override (spec 22 semantics).
        if (prior.status !== "failed") {
          throw new AppError(
            "Only failed runs can be resumed.",
            "run_not_resumable",
            409,
          );
        }
        // Stored JSONB launch input is parsed on read; a row that no longer
        // matches the contract cannot safely seed a new run.
        const launch = blogPostPipelineInputSchema.safeParse(prior.input);
        if (!launch.success) {
          throw new AppError(
            "This run cannot be resumed.",
            "run_not_resumable",
            409,
          );
        }

        const steps = await repos.activityLog.listStepsForRun({
          orgId,
          runId: prior.id,
        });
        const approval = await repos.approvals.findApprovalByRunId({
          orgId,
          runId: prior.id,
        });
        const plan = buildResumePlan(steps, approval?.status === "approved");

        // New linked run, same pre-create pattern as POST /runs; completed
        // prior steps are copied so the new run's rail and audit trail show
        // the carried work (original attempts/timestamps — the worker only
        // writes rows for steps it actually executes).
        const id = randomUUID();
        const temporalWorkflowId = `run-${id}`;
        const run = await repos.runs.createRun({
          id,
          orgId,
          workflowName: prior.workflowName,
          temporalWorkflowId,
          status: "pending",
          input: launch.data,
          resumedFromRunId: prior.id,
        });
        for (const step of plan.carriedSteps) {
          await repos.activityLog.upsertStep({
            orgId,
            runId: run.id,
            stepKind: step.stepKind,
            status: "completed",
            attempt: step.attempt,
            input: step.input,
            output: step.output,
            startedAt: step.startedAt,
            completedAt: step.completedAt,
          });
        }

        try {
          const { temporalRunId } = await temporal.startContentPipeline({
            workflowId: temporalWorkflowId,
            input: {
              ...launch.data,
              orgId,
              ...(plan.resumeFrom ? { resumeFrom: plan.resumeFrom } : {}),
            },
          });
          return reply.code(201).send(toRunResource({ ...run, temporalRunId }));
        } catch (err) {
          req.log.error(
            { err, runId: id, resumedFromRunId: prior.id, orgId },
            "resume workflow start failed",
          );
          await repos.runs.markRunTerminal({
            orgId,
            temporalWorkflowId,
            status: "failed",
            error: "The run could not be started",
          });
          throw new AppError(
            "The run could not be resumed. Try again.",
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
        const cursor = query.data.cursor
          ? decodeKeysetCursor(query.data.cursor)
          : undefined;

        const page = await repos.runs.listRuns({
          orgId,
          limit: query.data.limit,
          cursor,
        });
        return {
          items: page.items.map(toRunResource),
          nextCursor: page.nextCursor ? encodeKeysetCursor(page.nextCursor) : null,
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
