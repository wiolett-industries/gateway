CREATE TABLE "docker_image_registry_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"image_repository" text NOT NULL,
	"registry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_image_registry_mappings_node_repo_unique" UNIQUE("node_id","image_repository")
);
--> statement-breakpoint
ALTER TABLE "docker_image_registry_mappings" ADD CONSTRAINT "docker_image_registry_mappings_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_image_registry_mappings" ADD CONSTRAINT "docker_image_registry_mappings_registry_id_docker_registries_id_fk" FOREIGN KEY ("registry_id") REFERENCES "public"."docker_registries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "docker_image_registry_mappings_registry_id_idx" ON "docker_image_registry_mappings" USING btree ("registry_id");
