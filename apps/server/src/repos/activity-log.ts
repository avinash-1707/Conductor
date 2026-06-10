// Bound `activity_log` repo (implementation in @conductor/db — the worker
// writes step rows through the same helpers; the server reads them for
// Run Detail).
import { createActivityLogRepo } from "@conductor/db";
import { db } from "../db/client";

export type { Step, NewStep } from "@conductor/db";

export const { upsertStep, startStepAttempt, completeStep, failStepAttempt, listStepsForRun } =
  createActivityLogRepo(db);
