CREATE TABLE "integration_connector_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"remote_registry_id" varchar(128),
	"project_remote_id" varchar(128),
	"project_full_path" text,
	"registry_url" text NOT NULL,
	"name" text NOT NULL,
	"status" varchar(32) DEFAULT 'available' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inaccessible_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_registry_connector_url_unique" UNIQUE("connector_id","registry_url")
);
--> statement-breakpoint
ALTER TABLE "integration_connectors" ADD COLUMN "sync_last_overlap_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integration_connector_registries" ADD CONSTRAINT "integration_connector_registries_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_registry_connector_idx" ON "integration_connector_registries" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "integration_registry_project_idx" ON "integration_connector_registries" USING btree ("connector_id","project_remote_id");