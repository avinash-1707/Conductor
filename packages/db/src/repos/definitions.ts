import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
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
type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function createDefinitionVersionInTransaction(
  tx: DbTransaction,
  args: {
    orgId: string;
    name: string;
    description?: string;
    graphSpec: GraphSpec;
    parameters?: Record<string, unknown>;
  },
): Promise<Definition> {
  const spec = graphSpecSchema.parse(args.graphSpec);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${args.orgId}), hashtext(${args.name}))`,
  );
  const rows = await tx
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
}

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
     * is serialized with a transaction-scoped advisory lock. The unique index
     * remains the final invariant, while the lock makes allocation deterministic
     * for concurrent saves of the same organization/name pair.
     */
    async createDefinitionVersion(args: {
      orgId: string;
      name: string;
      description?: string;
      graphSpec: GraphSpec;
      parameters?: Record<string, unknown>;
    }): Promise<Definition> {
      return db.transaction((tx) => createDefinitionVersionInTransaction(tx, args));
    },

    async findDefinitionById(args: { orgId: string; id: string }): Promise<Definition | undefined> {
      const rows = await db
        .select()
        .from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.orgId, args.orgId), eq(workflowDefinitions.id, args.id)))
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
          and(eq(workflowDefinitions.orgId, args.orgId), eq(workflowDefinitions.name, args.name)),
        )
        .orderBy(desc(workflowDefinitions.version))
        .limit(1);
      return rows[0];
    },

    async listDefinitionVersions(args: { orgId: string; name: string }): Promise<Definition[]> {
      return db
        .select()
        .from(workflowDefinitions)
        .where(
          and(eq(workflowDefinitions.orgId, args.orgId), eq(workflowDefinitions.name, args.name)),
        )
        .orderBy(desc(workflowDefinitions.version));
    },

    /**
     * The latest version of each named definition, alphabetical, name-keyset
     * paginated (Unit 32 — the canvas "Open" picker). DISTINCT ON (name) with
     * (name asc, version desc) ordering picks the newest row per name.
     */
    async listLatestDefinitions(args: {
      orgId: string;
      limit: number;
      cursorName?: string;
    }): Promise<{ items: Definition[]; nextCursorName: string | null }> {
      const rows = await db
        .selectDistinctOn([workflowDefinitions.name])
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.orgId, args.orgId),
            args.cursorName ? gt(workflowDefinitions.name, args.cursorName) : undefined,
          ),
        )
        .orderBy(asc(workflowDefinitions.name), desc(workflowDefinitions.version))
        .limit(args.limit + 1);
      const items = rows.slice(0, args.limit);
      return {
        items,
        nextCursorName: rows.length > args.limit ? items[items.length - 1]!.name : null,
      };
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
