CREATE TABLE "publish_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publish_deliveries" ADD CONSTRAINT "publish_deliveries_org_id_organization_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publish_deliveries_org_key_uidx" ON "publish_deliveries" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "publish_deliveries_org_created_idx" ON "publish_deliveries" USING btree ("org_id","created_at");