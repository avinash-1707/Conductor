import { isDeepStrictEqual } from "node:util";
import { templateCatalog, type DefinitionParameters, type TemplateKey } from "@conductor/shared";
import type { Definition } from "@conductor/db";
import { repos } from "../repos/index";

/**
 * Template seeding (Unit 26) — templates are code-curated, DB-pinned: the
 * shared catalog defines what a template IS; `workflow_definitions` rows are
 * the per-org immutable versions runs pin via `definition_id`. This helper
 * materializes (or rolls forward) the org's pinned row for a catalog entry.
 */

/**
 * Returns the org's latest definition row for the template, creating a new
 * version when none exists or when the catalog has evolved since the latest
 * row was written (spec or parameters deep-differ — a new immutable version,
 * never an update, so existing runs keep pointing at exactly what they ran).
 * Idempotent; the unique `(org, name, version)` index is the race guard.
 */
export async function ensureTemplateDefinition(
  orgId: string,
  key: TemplateKey,
): Promise<Definition> {
  const template = templateCatalog[key];
  const parameters: DefinitionParameters = { templateKey: key };
  const latest = await repos.definitions.findLatestDefinition({
    orgId,
    name: template.name,
  });
  if (
    latest &&
    isDeepStrictEqual(latest.graphSpec, template.spec) &&
    isDeepStrictEqual(latest.parameters, parameters)
  ) {
    return latest;
  }
  try {
    return await repos.definitions.createDefinitionVersion({
      orgId,
      name: template.name,
      description: template.description,
      graphSpec: template.spec,
      parameters,
    });
  } catch (err) {
    // Lost the unique-index race to a concurrent seeding — use the winner.
    const winner = await repos.definitions.findLatestDefinition({
      orgId,
      name: template.name,
    });
    if (winner && isDeepStrictEqual(winner.graphSpec, template.spec)) return winner;
    throw err;
  }
}
