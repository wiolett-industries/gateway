CREATE TABLE "docker_migration_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"migration_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_identity" text NOT NULL,
	"target_identity" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"transferred_bytes" bigint DEFAULT 0 NOT NULL,
	"compression" text,
	"artifact_digest" text,
	"source_manifest_root" text,
	"target_manifest_root" text,
	"entry_count" integer,
	"logical_bytes" bigint,
	"state" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docker_migration_node_locks" (
	"node_id" uuid NOT NULL,
	"migration_id" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_migration_node_locks_pkey" PRIMARY KEY("node_id")
);
--> statement-breakpoint
CREATE TABLE "docker_migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_type" text NOT NULL,
	"resource_name" text NOT NULL,
	"deployment_id" uuid,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"keep_source" boolean DEFAULT false NOT NULL,
	"source_state" text NOT NULL,
	"source_fingerprint" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"phase" text DEFAULT 'queued' NOT NULL,
	"preflight" jsonb NOT NULL,
	"plan" jsonb NOT NULL,
	"verification" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"proxy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"progress" jsonb DEFAULT '{"completedPhases":[]}'::jsonb NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"cancellation_requested_by_id" uuid,
	"lease_owner" text,
	"lease_heartbeat_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_by_id" uuid,
	"cutover_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "docker_migration_artifacts" ADD CONSTRAINT "docker_migration_artifacts_migration_id_docker_migrations_id_fk" FOREIGN KEY ("migration_id") REFERENCES "public"."docker_migrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_migration_node_locks" ADD CONSTRAINT "docker_migration_node_locks_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_migration_node_locks" ADD CONSTRAINT "docker_migration_node_locks_migration_id_docker_migrations_id_fk" FOREIGN KEY ("migration_id") REFERENCES "public"."docker_migrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_migrations" ADD CONSTRAINT "docker_migrations_source_node_id_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_migrations" ADD CONSTRAINT "docker_migrations_target_node_id_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_migrations" ADD CONSTRAINT "docker_migrations_cancellation_requested_by_id_users_id_fk" FOREIGN KEY ("cancellation_requested_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_migrations" ADD CONSTRAINT "docker_migrations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "docker_migration_artifacts_migration_idx" ON "docker_migration_artifacts" USING btree ("migration_id");--> statement-breakpoint
CREATE INDEX "docker_migration_artifacts_state_idx" ON "docker_migration_artifacts" USING btree ("state");--> statement-breakpoint
CREATE INDEX "docker_migration_node_locks_migration_idx" ON "docker_migration_node_locks" USING btree ("migration_id");--> statement-breakpoint
CREATE INDEX "docker_migrations_status_idx" ON "docker_migrations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "docker_migrations_source_node_idx" ON "docker_migrations" USING btree ("source_node_id");--> statement-breakpoint
CREATE INDEX "docker_migrations_target_node_idx" ON "docker_migrations" USING btree ("target_node_id");--> statement-breakpoint
CREATE INDEX "docker_migrations_created_at_idx" ON "docker_migrations" USING btree ("created_at");