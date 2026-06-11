import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { WorkflowNotFoundError } from "@temporalio/client";
import {
  approvalSignalPayloadSchema,
  type ApprovalDecision,
  type ApprovalResource,
} from "@conductor/shared";
import type { Approval } from "@conductor/db";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../errors";
import { activeOrgId } from "../lib/active-org";
import { decodeKeysetCursor, encodeKeysetCursor } from "../lib/keyset-cursor";
import { repos } from "../repos/index";
import type { RunGateway } from "../temporal";

/**
 * Approval queue routes (Unit 14). Any member of the org can decide (v1
 * roles). Decisions are signal-first: the Temporal signal resumes the
 * suspended run, then the decision is claimed atomically in Postgres — a
 * duplicate signal is harmless (the workflow takes the first valid decision),
 * but a recorded decision whose signal never sent would strand the run until
 * the 24h expiry. The org id comes from verified JWT claims only (invariant
 * 11); the run projection stays worker-owned.
 */

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

const idParamSchema = z.object({ id: z.uuid() });

function toApprovalResource(approval: Approval): ApprovalResource {
  return {
    id: approval.id,
    runId: approval.runId,
    status: approval.status,
    context: approval.context,
    reviewerId: approval.reviewerId,
    decidedAt: approval.decidedAt?.toISOString() ?? null,
    createdAt: approval.createdAt.toISOString(),
  };
}

export function approvalRoutes(temporal: RunGateway): FastifyPluginAsync {
  return async (app) => {
    app.get(
      "/approvals",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      async (req) => {
        const orgId = activeOrgId(req);
        const query = listQuerySchema.safeParse(req.query);
        if (!query.success) throw new ValidationError("Invalid list parameters");
        const cursor = query.data.cursor
          ? decodeKeysetCursor(query.data.cursor)
          : undefined;

        const page = await repos.approvals.listPendingApprovals({
          orgId,
          limit: query.data.limit,
          cursor,
        });
        return {
          items: page.items.map(toApprovalResource),
          nextCursor: page.nextCursor ? encodeKeysetCursor(page.nextCursor) : null,
        };
      },
    );

    const decide = (decision: ApprovalDecision) =>
      async function handler(req: FastifyRequest) {
        const orgId = activeOrgId(req);
        const reviewerId = req.auth?.userId;
        if (!reviewerId) throw new ForbiddenError("No authenticated reviewer");

        // Non-uuid, unknown, and cross-org ids are the same 404 (tenancy
        // semantics: absence and denial are indistinguishable).
        const params = idParamSchema.safeParse(req.params);
        if (!params.success) throw new NotFoundError("Approval not found");
        const approval = await repos.approvals.findApprovalById({
          orgId,
          id: params.data.id,
        });
        if (!approval) throw new NotFoundError("Approval not found");
        if (approval.status !== "pending") {
          throw new AppError(
            "This approval has already been decided",
            "approval_already_decided",
            409,
          );
        }
        const run = await repos.runs.findRunById({ orgId, id: approval.runId });
        if (!run) throw new NotFoundError("Approval not found");

        const payload = approvalSignalPayloadSchema.parse({
          decision,
          reviewerId,
          decidedAt: new Date().toISOString(),
        });

        // Signal first (liveness), then claim (audit). See module doc.
        try {
          await temporal.signalApprovalDecision({
            temporalWorkflowId: run.temporalWorkflowId,
            payload,
          });
        } catch (err) {
          if (err instanceof WorkflowNotFoundError) {
            // The run already closed (e.g. the 24h gate expired).
            throw new AppError(
              "This approval is no longer active",
              "approval_not_active",
              409,
            );
          }
          req.log.error(
            { err, approvalId: approval.id, runId: run.id, orgId },
            "approval signal failed",
          );
          throw new AppError(
            "The decision could not be delivered. Try again.",
            "approval_signal_failed",
            502,
          );
        }

        const claimed = await repos.approvals.claimDecision({
          orgId,
          id: approval.id,
          decision,
          reviewerId,
          decidedAt: new Date(payload.decidedAt),
        });
        if (!claimed) {
          // Another reviewer decided in the same instant; their record stands.
          throw new AppError(
            "This approval has already been decided",
            "approval_already_decided",
            409,
          );
        }
        // Golden-path instrumentation (Unit 29).
        req.log.info(
          { event: "golden_path.approval_decided", orgId, decision, runId: approval.runId },
          "approval decided",
        );
        return toApprovalResource(claimed);
      };

    app.post(
      "/approvals/:id/approve",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      decide("approved"),
    );
    app.post(
      "/approvals/:id/reject",
      { preHandler: (req, reply) => app.requireSession(req, reply) },
      decide("rejected"),
    );
  };
}
