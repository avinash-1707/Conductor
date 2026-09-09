CREATE TABLE "canvas_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "source_definition_id" uuid REFERENCES "workflow_definitions"("id") ON DELETE set null,
  "document" jsonb NOT NULL,
  "revision" integer DEFAULT 0 NOT NULL,
  "created_by_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "updated_by_user_id" text REFERENCES "user"("id") ON DELETE set null,
  "saved_definition_id" uuid REFERENCES "workflow_definitions"("id") ON DELETE set null,
  "saved_revision" integer,
  "closed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "canvas_drafts_org_updated_idx" ON "canvas_drafts" USING btree ("org_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "canvas_draft_operations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "draft_id" uuid NOT NULL REFERENCES "canvas_drafts"("id") ON DELETE cascade,
  "org_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "client_operation_id" uuid NOT NULL,
  "operation_hash" text NOT NULL,
  "revision" integer NOT NULL,
  "author_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE restrict,
  "operation" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "canvas_draft_operations_client_uidx" UNIQUE("draft_id", "author_user_id", "client_operation_id"),
  CONSTRAINT "canvas_draft_operations_revision_uidx" UNIQUE("draft_id", "revision")
);
--> statement-breakpoint
CREATE INDEX "canvas_draft_operations_org_draft_idx" ON "canvas_draft_operations" USING btree ("org_id", "draft_id");
