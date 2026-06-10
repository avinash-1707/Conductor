import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { orgApiKeys } from "../schema";

/**
 * Org-scoped helpers for `org_api_keys` (one row per org). Stores opaque
 * ciphertext + a `last4` hint; encryption lives in the server's secrets
 * binding (Unit 11) and the worker decrypts at activity call time (Unit 12).
 * The plaintext key is never stored, returned, or logged (invariant 12).
 */
export type OrgApiKey = typeof orgApiKeys.$inferSelect;

export function createApiKeysRepo(db: Db) {
  return {
    async upsertOrgApiKey(args: {
      orgId: string;
      ciphertext: string;
      last4: string;
    }): Promise<OrgApiKey> {
      const rows = await db
        .insert(orgApiKeys)
        .values({ orgId: args.orgId, ciphertext: args.ciphertext, last4: args.last4 })
        .onConflictDoUpdate({
          target: orgApiKeys.orgId,
          set: { ciphertext: args.ciphertext, last4: args.last4, updatedAt: new Date() },
        })
        .returning();
      return rows[0]!;
    },

    async findOrgApiKey(args: { orgId: string }): Promise<OrgApiKey | undefined> {
      const rows = await db
        .select()
        .from(orgApiKeys)
        .where(eq(orgApiKeys.orgId, args.orgId))
        .limit(1);
      return rows[0];
    },
  };
}

export type ApiKeysRepo = ReturnType<typeof createApiKeysRepo>;
