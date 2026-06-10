import { and, eq } from "drizzle-orm";
import type { PublishReceipt } from "@conductor/shared";
import type { Db } from "../client";
import { publishDeliveries } from "../schema";

/**
 * Org-scoped publish idempotency ledger (Unit 12). `recordDelivery` is
 * insert-or-return-existing on the unique `(org_id, idempotency_key)`, so two
 * racing workers converge on one receipt and a Temporal retry returns the
 * first delivery's receipt instead of delivering twice (invariant 2).
 */
export type PublishDelivery = typeof publishDeliveries.$inferSelect;

export function createPublishDeliveriesRepo(db: Db) {
  return {
    async findDelivery(args: {
      orgId: string;
      idempotencyKey: string;
    }): Promise<PublishDelivery | undefined> {
      const rows = await db
        .select()
        .from(publishDeliveries)
        .where(
          and(
            eq(publishDeliveries.orgId, args.orgId),
            eq(publishDeliveries.idempotencyKey, args.idempotencyKey),
          ),
        )
        .limit(1);
      return rows[0];
    },

    async recordDelivery(args: {
      orgId: string;
      idempotencyKey: string;
      receipt: PublishReceipt;
    }): Promise<PublishDelivery> {
      const inserted = await db
        .insert(publishDeliveries)
        .values({
          orgId: args.orgId,
          idempotencyKey: args.idempotencyKey,
          receipt: args.receipt,
        })
        .onConflictDoNothing({
          target: [publishDeliveries.orgId, publishDeliveries.idempotencyKey],
        })
        .returning();
      if (inserted[0]) return inserted[0];
      // Lost the race — the winner's receipt is the authoritative one.
      const existing = await this.findDelivery(args);
      if (!existing) {
        throw new Error("publish delivery ledger row vanished after conflict");
      }
      return existing;
    },
  };
}

export type PublishDeliveriesRepo = ReturnType<typeof createPublishDeliveriesRepo>;
