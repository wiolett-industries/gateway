CREATE TABLE "docker_deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"name" text NOT NULL,
	"desired_config" jsonb NOT NULL,
	"active_slot" text DEFAULT 'blue' NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"router_name" text NOT NULL,
	"router_image" text DEFAULT 'nginx:alpine' NOT NULL,
	"network_name" text NOT NULL,
	"health_config" jsonb NOT NULL,
	"drain_seconds" integer DEFAULT 30 NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_deployments_node_id_name_unique" UNIQUE("node_id","name")
);
--> statement-breakpoint
CREATE TABLE "docker_deployment_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"host_port" integer NOT NULL,
	"container_port" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_deployment_routes_deployment_host_port_unique" UNIQUE("deployment_id","host_port")
);
--> statement-breakpoint
CREATE TABLE "docker_deployment_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"container_id" text,
	"container_name" text NOT NULL,
	"image" text,
	"desired_config" jsonb,
	"status" text DEFAULT 'empty' NOT NULL,
	"health" text DEFAULT 'unknown' NOT NULL,
	"draining_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_deployment_slots_deployment_slot_unique" UNIQUE("deployment_id","slot")
);
--> statement-breakpoint
CREATE TABLE "docker_deployment_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"from_slot" text,
	"to_slot" text,
	"image" text,
	"trigger_source" text DEFAULT 'manual' NOT NULL,
	"task_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "docker_deployments" ADD CONSTRAINT "docker_deployments_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_deployments" ADD CONSTRAINT "docker_deployments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_deployments" ADD CONSTRAINT "docker_deployments_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_deployment_routes" ADD CONSTRAINT "docker_deployment_routes_deployment_id_docker_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."docker_deployments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_deployment_slots" ADD CONSTRAINT "docker_deployment_slots_deployment_id_docker_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."docker_deployments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_deployment_releases" ADD CONSTRAINT "docker_deployment_releases_deployment_id_docker_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."docker_deployments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_deployment_releases" ADD CONSTRAINT "docker_deployment_releases_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_webhooks" ADD COLUMN "target_type" text DEFAULT 'container' NOT NULL;
--> statement-breakpoint
ALTER TABLE "docker_webhooks" ADD COLUMN "deployment_id" uuid;
--> statement-breakpoint
ALTER TABLE "docker_webhooks" ADD CONSTRAINT "docker_webhooks_deployment_id_docker_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."docker_deployments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "docker_deployments_node_id_idx" ON "docker_deployments" USING btree ("node_id");
--> statement-breakpoint
CREATE INDEX "docker_deployment_routes_deployment_id_idx" ON "docker_deployment_routes" USING btree ("deployment_id");
--> statement-breakpoint
CREATE INDEX "docker_deployment_slots_deployment_id_idx" ON "docker_deployment_slots" USING btree ("deployment_id");
--> statement-breakpoint
CREATE INDEX "docker_deployment_releases_deployment_id_idx" ON "docker_deployment_releases" USING btree ("deployment_id");
