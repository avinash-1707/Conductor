import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { orgModelSettings } from "../schema";

/**
 * Org-scoped helpers for `org_model_settings` (one row per org, Unit 33).
 * Null columns mean "platform default" — the worker applies the fallback at
 * activity call time, the server only stores the choice.
 */
export type OrgModelSettingsRow = typeof orgModelSettings.$inferSelect;

export function createModelSettingsRepo(db: Db) {
  return {
    async findOrgModelSettings(args: {
      orgId: string;
    }): Promise<OrgModelSettingsRow | undefined> {
      const rows = await db
        .select()
        .from(orgModelSettings)
        .where(eq(orgModelSettings.orgId, args.orgId))
        .limit(1);
      return rows[0];
    },

    async upsertOrgModelSettings(args: {
      orgId: string;
      researchModel: string | null;
      writingModel: string | null;
    }): Promise<OrgModelSettingsRow> {
      const rows = await db
        .insert(orgModelSettings)
        .values({
          orgId: args.orgId,
          researchModel: args.researchModel,
          writingModel: args.writingModel,
        })
        .onConflictDoUpdate({
          target: orgModelSettings.orgId,
          set: {
            researchModel: args.researchModel,
            writingModel: args.writingModel,
            updatedAt: new Date(),
          },
        })
        .returning();
      return rows[0]!;
    },
  };
}

export type ModelSettingsRepo = ReturnType<typeof createModelSettingsRepo>;
