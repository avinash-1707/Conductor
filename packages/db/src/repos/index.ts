import type { Db } from "../client";
import { createRunsRepo } from "./runs";
import { createActivityLogRepo } from "./activity-log";
import { createApprovalsRepo } from "./approvals";
import { createDefinitionsRepo } from "./definitions";
import { createApiKeysRepo } from "./api-keys";
import { createPublishDeliveriesRepo } from "./publish-deliveries";

/**
 * Org-scoped repository factory — the only sanctioned way to touch domain
 * tables (architecture invariant 11). Every helper takes the org id from the
 * caller's verified context; cross-org ids resolve to `undefined` → 404.
 */
export function createRepos(db: Db) {
  return {
    runs: createRunsRepo(db),
    activityLog: createActivityLogRepo(db),
    approvals: createApprovalsRepo(db),
    definitions: createDefinitionsRepo(db),
    apiKeys: createApiKeysRepo(db),
    publishDeliveries: createPublishDeliveriesRepo(db),
  };
}

export type Repos = ReturnType<typeof createRepos>;

export { createRunsRepo, type RunsRepo, type Run, type NewRun, type RunCursor } from "./runs";
export {
  createActivityLogRepo,
  type ActivityLogRepo,
  type Step,
  type NewStep,
} from "./activity-log";
export {
  createApprovalsRepo,
  type ApprovalsRepo,
  type Approval,
  type NewApproval,
  type ApprovalCursor,
} from "./approvals";
export {
  createDefinitionsRepo,
  type DefinitionsRepo,
  type Definition,
  type NewDefinition,
} from "./definitions";
export { createApiKeysRepo, type ApiKeysRepo, type OrgApiKey } from "./api-keys";
export {
  createPublishDeliveriesRepo,
  type PublishDeliveriesRepo,
  type PublishDelivery,
} from "./publish-deliveries";
