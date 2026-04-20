CREATE TABLE "docker_env_vars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"container_name" text NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_env_var_unique" UNIQUE("node_id","container_name","key")
);
--> statement-breakpoint
ALTER TABLE "docker_env_vars" ADD CONSTRAINT "docker_env_vars_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "docker_env_var_container_idx" ON "docker_env_vars" USING btree ("node_id","container_name");
