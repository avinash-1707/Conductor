import { z } from "zod";

import { graphSpecSchema } from "./graph-spec";
import { templateKeySchema } from "./template";

/**
 * Workflow-definition API resources (Unit 30) — the read side of the
 * `workflow_definitions` version rows runs pin via `definition_id`. The
 * canvas viewer fetches a run's pinned spec through this contract; the
 * canvas editor (Units 31–32) saves new versions into the same rows.
 */

export const definitionResourceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  version: z.number().int().positive(),
  /** Nullable: pre-Unit-24 rows were created before specs existed. */
  graphSpec: graphSpecSchema.nullable(),
  /** The catalog template this row was seeded from; null for canvas-authored rows. */
  templateKey: templateKeySchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type DefinitionResource = z.infer<typeof definitionResourceSchema>;
