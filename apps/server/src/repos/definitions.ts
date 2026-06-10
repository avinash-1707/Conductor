// Bound `workflow_definitions` repo (implementation in @conductor/db).
import { createDefinitionsRepo } from "@conductor/db";
import { db } from "../db/client";

export type { Definition, NewDefinition } from "@conductor/db";

export const {
  createDefinition,
  createDefinitionVersion,
  findDefinitionById,
  findLatestDefinition,
  listDefinitionVersions,
  listDefinitions,
} = createDefinitionsRepo(db);
