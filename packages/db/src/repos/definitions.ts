import { and, desc, eq, sql } from "drizzle-orm";
import { graphSpecSchema, type GraphSpec } from "@conductor/shared";
import type { Db } from "../client";
import { workflowDefinitions } from "../schema";

/**
 * Org-scoped helpers for `workflow_definitions` (curated templates; the canvas
 * edits the same rows later). Versioning (Unit 24): every saved spec is a new
 * immutable `(org, name, version)` row — version pinning means a run's
 * `definition_id` always points at exactly the spec it executed.
 */
export type Definition = typeof workflowDefinitions.$inferSelect;
export type NewDefinition = typeof workflowDefinitions.$inferInsert;

export function createDefinitionsRepo(db: Db) {
  return {
    async createDefinition(values: NewDefinition): Promise<Definition> {
      const rows = await db.insert(workflowDefinitions).values(values).returning();
      return rows[0]!;
    },

    /**
     * Inserts the next version of a named template. The spec is parsed at this
     * door (JSONB columns always have a shared schema — code-standards Data &
     * Storage), so an invalid graph can never be persisted; the version number
     * is computed in the insert itself, with the unique `(org, name, version)`
     * index as the race guard.
     */
    async createDefinitionVersion(args: {
      orgId: string;
      name: string;
      description?: string;
      graphSpec: GraphSpec;
      parameters?: Record<string, unknown>;
    }): Promise<Definition> {
      const spec = graphSpecSchema.parse(args.graphSpec);
      const rows = await db
        .insert(workflowDefinitions)
        .values({
          orgId: args.orgId,
          name: args.name,
          description: args.description,
          graphSpec: spec,
          parameters: args.parameters ?? {},
          version: sql`(
            select coalesce(max(${workflowDefinitions.version}), 0) + 1
            from ${workflowDefinitions}
            where ${workflowDefinitions.orgId} = ${args.orgId}
              and ${workflowDefinitions.name} = ${args.name}
          )`,
        })
        .returning();
      return rows[0]!;
    },

    async findDefinitionById(args: {
      orgId: string;
      id: string;
    }): Promise<Definition | undefined> {
      const rows = await db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.orgId, args.orgId),
            eq(workflowDefinitions.id, args.id),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async findLatestDefinition(args: {
      orgId: string;
      name: string;
    }): Promise<Definition | undefined> {
      const rows = await db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.orgId, args.orgId),
            eq(workflowDefinitions.name, args.name),
          ),
        )
        .orderBy(desc(workflowDefinitions.version))
        .limit(1);
      return rows[0];
    },

    async listDefinitionVersions(args: {
      orgId: string;
      name: string;
    }): Promise<Definition[]> {
      return db
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.orgId, args.orgId),
            eq(workflowDefinitions.name, args.name),
          ),
        )
        .orderBy(desc(workflowDefinitions.version));
    },

    async listDefinitions(args: { orgId: string }): Promise<Definition[]> {
      return db
        .select()
        .from(workflowDefinitions)
        .where(eq(workflowDefinitions.orgId, args.orgId))
        .orderBy(desc(workflowDefinitions.createdAt));
    },
  };
}

export type DefinitionsRepo = ReturnType<typeof createDefinitionsRepo>;
