// Bound `approval_requests` repo (implementation in @conductor/db — the
// worker creates/closes gates through the same helpers; the server lists and
// records decisions).
import { createApprovalsRepo } from "@conductor/db";
import { db } from "../db/client";

export type { Approval, NewApproval, ApprovalCursor } from "@conductor/db";

export const {
  createApproval,
  findApprovalById,
  findApprovalByRunId,
  upsertApprovalForRun,
  claimDecision,
  closePendingForRun,
  listPendingApprovals,
} = createApprovalsRepo(db);
