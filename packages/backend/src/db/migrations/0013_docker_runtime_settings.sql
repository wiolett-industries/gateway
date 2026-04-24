CREATE TABLE "docker_runtime_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"container_name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docker_runtime_settings" ADD CONSTRAINT "docker_runtime_settings_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_runtime_settings" ADD CONSTRAINT "docker_runtime_settings_unique" UNIQUE("node_id","container_name");
--> statement-breakpoint
CREATE INDEX "docker_runtime_settings_container_idx" ON "docker_runtime_settings" USING btree ("node_id","container_name");
