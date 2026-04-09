CREATE TABLE IF NOT EXISTS "docker_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"container_name" text NOT NULL,
	"token" uuid NOT NULL DEFAULT gen_random_uuid(),
	"enabled" boolean NOT NULL DEFAULT true,
	"cleanup_enabled" boolean NOT NULL DEFAULT false,
	"retention_count" integer NOT NULL DEFAULT 2,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now(),
	CONSTRAINT "docker_webhooks_node_id_container_name_unique" UNIQUE("node_id","container_name")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "docker_webhooks_token_idx" ON "docker_webhooks" USING btree ("token");
--> statement-breakpoint
ALTER TABLE "docker_webhooks" ADD CONSTRAINT "docker_webhooks_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
