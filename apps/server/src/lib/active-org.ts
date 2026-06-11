import type { FastifyRequest } from "fastify";
import { ForbiddenError } from "../errors";

/**
 * The caller's active org from the verified JWT claims — the only place an
 * org id may come from (architecture invariant 11). A session without an
 * active org cannot touch org-scoped resources (403).
 */
export function activeOrgId(req: FastifyRequest): string {
  const orgId = req.auth?.activeOrganizationId;
  if (!orgId) throw new ForbiddenError("No active organization");
  return orgId;
}
