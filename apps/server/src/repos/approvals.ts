// Bound `approval_requests` repo (implementation in @conductor/db).
import { createApprovalsRepo } from "@conductor/db";
import { db } from "../db/client";

export type { Approval, NewApproval } from "@conductor/db";

export const { createApproval, findApprovalById, listPendingApprovals } =
  createApprovalsRepo(db);
