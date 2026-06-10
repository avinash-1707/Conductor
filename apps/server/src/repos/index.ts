// Org-scoped repository barrel — `@conductor/db`'s factory bound to the
// server's singleton db. All domain-table access goes through these helpers
// (architecture invariant 11; code-standards "Data and Storage"). Raw Drizzle
// queries against domain tables outside this directory are forbidden.
import { createRepos } from "@conductor/db";
import { db } from "../db/client";

export const repos = createRepos(db);

export * as runsRepo from "./runs";
export * as activityLogRepo from "./activity-log";
export * as approvalsRepo from "./approvals";
export * as definitionsRepo from "./definitions";
export * as apiKeysRepo from "./api-keys";
