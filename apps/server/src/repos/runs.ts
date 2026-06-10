// Bound `workflow_runs` repo (implementation in @conductor/db — shared with
// the worker, which writes the projection rows; the server reads them and
// pre-creates the `pending` row when starting a run).
import { createRunsRepo } from "@conductor/db";
import { db } from "../db/client";

export type { Run, NewRun, RunCursor } from "@conductor/db";

export const { createRun, findRunById, findRunByTemporalId, listRuns, markRunStatus } =
  createRunsRepo(db);
