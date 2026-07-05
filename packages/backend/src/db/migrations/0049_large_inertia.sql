CREATE TABLE "integration_connector_allowlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"entry_type" varchar(32) NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"full_path" text NOT NULL,
	"name" text,
	"web_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_allowlist_connector_entry_unique" UNIQUE("connector_id","entry_type","remote_id")
);
--> statement-breakpoint
CREATE TABLE "integration_connector_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"full_path" text NOT NULL,
	"name" text NOT NULL,
	"web_url" text,
	"visibility" varchar(32),
	"default_branch" text,
	"archived" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inaccessible_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_project_connector_remote_unique" UNIQUE("connector_id","remote_id"),
	CONSTRAINT "integration_project_connector_path_unique" UNIQUE("connector_id","full_path")
);
--> statement-breakpoint
CREATE TABLE "integration_connector_registry_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"registry_id" uuid NOT NULL,
	"remote_registry_id" varchar(128),
	"project_remote_id" varchar(128),
	"project_full_path" text,
	"status" varchar(32) DEFAULT 'available' NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_registry_link_registry_unique" UNIQUE("registry_id")
);
--> statement-breakpoint
CREATE TABLE "integration_connectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"name" varchar(255) NOT NULL,
	"base_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"encrypted_token" text,
	"token_last4" varchar(16),
	"allowlist_mode" varchar(32) DEFAULT 'selected' NOT NULL,
	"settings" jsonb DEFAULT '{"autoSyncEnabled":true,"autoSyncIntervalSeconds":900,"cloneShallow":true,"cloneDepth":1,"cloneLfs":false,"cloneSubmodules":false,"cloneMaxSizeMb":1024,"cloneTimeoutSeconds":300}'::jsonb NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sync_status" varchar(32) DEFAULT 'never' NOT NULL,
	"sync_last_error" text,
	"sync_failure_count" integer DEFAULT 0 NOT NULL,
	"sync_started_at" timestamp with time zone,
	"sync_finished_at" timestamp with time zone,
	"sync_next_retry_at" timestamp with time zone,
	"tested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connector_provider_name_unique" UNIQUE("provider","name")
);
--> statement-breakpoint
ALTER TABLE "integration_connector_allowlist_entries" ADD CONSTRAINT "integration_connector_allowlist_entries_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connector_projects" ADD CONSTRAINT "integration_connector_projects_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connector_registry_links" ADD CONSTRAINT "integration_connector_registry_links_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connector_registry_links" ADD CONSTRAINT "integration_connector_registry_links_registry_id_docker_registries_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."docker_registries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_allowlist_connector_idx" ON "integration_connector_allowlist_entries" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "integration_project_connector_idx" ON "integration_connector_projects" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "integration_registry_link_connector_idx" ON "integration_connector_registry_links" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "integration_registry_link_project_idx" ON "integration_connector_registry_links" USING btree ("connector_id","project_remote_id");--> statement-breakpoint
CREATE INDEX "integration_connector_provider_idx" ON "integration_connectors" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "integration_connector_enabled_idx" ON "integration_connectors" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "integration_connector_sync_idx" ON "integration_connectors" USING btree ("provider","sync_status","sync_next_retry_at");