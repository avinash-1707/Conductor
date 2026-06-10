import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../client";
import { workflowDefinitions } from "../schema";

/**
 * Org-scoped helpers for `workflow_definitions` (curated templates; later the
 * canvas graph_spec). Versioning and spec validation arrive in Unit 24 — this
 * unit provides creation and scoped reads.
 */
export type Definition = typeof workflowDefinitions.$inferSelect;
export type NewDefinition = typeof workflowDefinitions.$inferInsert;

export function createDefinitionsRepo(db: Db) {
  return {
    async createDefinition(values: NewDefinition): Promise<Definition> {
      const rows = await db.insert(workflowDefinitions).values(values).returning();
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
