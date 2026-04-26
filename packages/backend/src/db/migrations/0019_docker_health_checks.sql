ALTER TYPE "public"."status_page_source_type" ADD VALUE IF NOT EXISTS 'docker_container';
--> statement-breakpoint
ALTER TYPE "public"."status_page_source_type" ADD VALUE IF NOT EXISTS 'docker_deployment';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "docker_health_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target" text NOT NULL,
	"node_id" uuid NOT NULL,
	"container_name" text,
	"deployment_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"scheme" text DEFAULT 'http' NOT NULL,
	"host_port" integer,
	"container_port" integer,
	"path" text DEFAULT '/' NOT NULL,
	"status_min" integer DEFAULT 200 NOT NULL,
	"status_max" integer DEFAULT 399 NOT NULL,
	"expected_body" text,
	"body_match_mode" "health_check_body_match_mode" DEFAULT 'includes' NOT NULL,
	"interval_seconds" integer DEFAULT 30 NOT NULL,
	"timeout_seconds" integer DEFAULT 5 NOT NULL,
	"slow_threshold" integer DEFAULT 1000 NOT NULL,
	"health_status" "health_status" DEFAULT 'unknown' NOT NULL,
	"last_health_check_at" timestamp with time zone,
	"health_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docker_health_checks" ADD CONSTRAINT "docker_health_checks_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_health_checks" ADD CONSTRAINT "docker_health_checks_deployment_id_docker_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."docker_deployments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "docker_health_checks_container_unique" ON "docker_health_checks" USING btree ("node_id","container_name");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "docker_health_checks_deployment_unique" ON "docker_health_checks" USING btree ("deployment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "docker_health_checks_node_idx" ON "docker_health_checks" USING btree ("node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "docker_health_checks_due_idx" ON "docker_health_checks" USING btree ("enabled","last_health_check_at");
