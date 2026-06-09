// @conductor/worker — Temporal worker: deterministic workflows + side-effecting
// activities. Bootstrap arrives in Unit 03. Placeholder keeps the package buildable.

import { SHARED_PACKAGE } from "@conductor/shared";

export const WORKER_PACKAGE = `${SHARED_PACKAGE}/worker` as const;
