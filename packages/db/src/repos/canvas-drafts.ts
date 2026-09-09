import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  applyCanvasOperation,
  canvasDocumentSchema,
  canvasDocumentToGraphSpec,
  type CanvasDocument,
  type CanvasOperation,
} from "@conductor/shared";
import type { Db } from "../client";
import { canvasDraftOperations, canvasDrafts, workflowDefinitions } from "../schema";
import { createDefinitionVersionInTransaction, type Definition } from "./definitions";

export type CanvasDraft = typeof canvasDrafts.$inferSelect;

function operationHash(operation: CanvasOperation): string {
  return createHash("sha256").update(JSON.stringify(operation)).digest("hex");
}

export function createCanvasDraftsRepo(db: Db) {
  return {
    async createDraft(args: {
      orgId: string;
      userId: string;
      sourceDefinitionId?: string;
      document: CanvasDocument;
    }): Promise<CanvasDraft> {
      const [draft] = await db
        .insert(canvasDrafts)
        .values({
          orgId: args.orgId,
          createdByUserId: args.userId,
          sourceDefinitionId: args.sourceDefinitionId,
          document: canvasDocumentSchema.parse(args.document),
        })
        .returning();
      return draft!;
    },

    async findDraftById(args: { orgId: string; id: string }): Promise<CanvasDraft | undefined> {
      const rows = await db
        .select()
        .from(canvasDrafts)
        .where(and(eq(canvasDrafts.orgId, args.orgId), eq(canvasDrafts.id, args.id)))
        .limit(1);
      return rows[0];
    },

    async applyOperation(args: {
      orgId: string;
      userId: string;
      draftId: string;
      clientOperationId: string;
      baseRevision: number;
      operation: CanvasOperation;
    }): Promise<
      | {
          kind: "accepted";
          draft: CanvasDraft;
          revision: number;
          operation: CanvasOperation;
          idempotent: boolean;
        }
      | { kind: "stale"; draft: CanvasDraft }
      | { kind: "not_found" }
      | { kind: "closed" }
      | { kind: "idempotency_mismatch" }
    > {
      const parsedOperation = args.operation;
      const hash = operationHash(parsedOperation);
      return db.transaction(async (tx) => {
        // Lock before checking revision and idempotency so concurrent writes are serialized.
        await tx.execute(
          sql`select 1 from ${canvasDrafts} where ${canvasDrafts.id} = ${args.draftId} and ${canvasDrafts.orgId} = ${args.orgId} for update`,
        );
        const [draft] = await tx
          .select()
          .from(canvasDrafts)
          .where(and(eq(canvasDrafts.id, args.draftId), eq(canvasDrafts.orgId, args.orgId)))
          .limit(1);
        if (!draft) return { kind: "not_found" } as const;

        const [prior] = await tx
          .select()
          .from(canvasDraftOperations)
          .where(
            and(
              eq(canvasDraftOperations.draftId, args.draftId),
              eq(canvasDraftOperations.authorUserId, args.userId),
              eq(canvasDraftOperations.clientOperationId, args.clientOperationId),
            ),
          )
          .limit(1);
        if (prior) {
          if (prior.operationHash !== hash) return { kind: "idempotency_mismatch" } as const;
          return {
            kind: "accepted",
            draft,
            revision: prior.revision,
            operation: prior.operation,
            idempotent: true,
          } as const;
        }
        if (draft.closedAt) return { kind: "closed" } as const;
        if (draft.revision !== args.baseRevision) return { kind: "stale", draft } as const;

        const document = applyCanvasOperation(
          canvasDocumentSchema.parse(draft.document),
          parsedOperation,
        );
        const revision = draft.revision + 1;
        const [updated] = await tx
          .update(canvasDrafts)
          .set({ document, revision, updatedByUserId: args.userId, updatedAt: new Date() })
          .where(eq(canvasDrafts.id, args.draftId))
          .returning();
        await tx.insert(canvasDraftOperations).values({
          draftId: args.draftId,
          orgId: args.orgId,
          clientOperationId: args.clientOperationId,
          operationHash: hash,
          revision,
          authorUserId: args.userId,
          operation: parsedOperation,
        });
        return {
          kind: "accepted",
          draft: updated!,
          revision,
          operation: parsedOperation,
          idempotent: false,
        } as const;
      });
    },

    async saveDraft(args: {
      orgId: string;
      draftId: string;
      revision: number;
    }): Promise<
      { kind: "saved"; definition: Definition } | { kind: "stale" } | { kind: "not_found" }
    > {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select 1 from ${canvasDrafts} where ${canvasDrafts.id} = ${args.draftId} and ${canvasDrafts.orgId} = ${args.orgId} for update`,
        );
        const [draft] = await tx
          .select()
          .from(canvasDrafts)
          .where(and(eq(canvasDrafts.id, args.draftId), eq(canvasDrafts.orgId, args.orgId)))
          .limit(1);
        if (!draft) return { kind: "not_found" } as const;
        if (draft.revision !== args.revision) return { kind: "stale" } as const;
        if (draft.savedRevision === draft.revision && draft.savedDefinitionId) {
          const [definition] = await tx
            .select()
            .from(workflowDefinitions)
            .where(eq(workflowDefinitions.id, draft.savedDefinitionId))
            .limit(1);
          if (definition) return { kind: "saved", definition } as const;
        }
        const graphSpec = canvasDocumentToGraphSpec(canvasDocumentSchema.parse(draft.document));
        const definition = await createDefinitionVersionInTransaction(tx, {
          orgId: args.orgId,
          name: graphSpec.name,
          graphSpec,
          parameters: {},
        });
        await tx
          .update(canvasDrafts)
          .set({
            savedDefinitionId: definition.id,
            savedRevision: draft.revision,
            updatedAt: new Date(),
          })
          .where(eq(canvasDrafts.id, draft.id));
        return { kind: "saved", definition } as const;
      });
    },
  };
}

export type CanvasDraftsRepo = ReturnType<typeof createCanvasDraftsRepo>;
