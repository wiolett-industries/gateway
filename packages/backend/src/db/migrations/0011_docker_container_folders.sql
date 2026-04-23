CREATE TABLE "docker_container_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"node_id" uuid,
	"compose_project" varchar(255),
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docker_container_folder_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"container_name" varchar(255) NOT NULL,
	"folder_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "docker_container_folders" ADD CONSTRAINT "docker_container_folders_parent_id_docker_container_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."docker_container_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_container_folders" ADD CONSTRAINT "docker_container_folders_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_container_folders" ADD CONSTRAINT "docker_container_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_container_folder_assignments" ADD CONSTRAINT "docker_container_folder_assignments_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "docker_container_folder_assignments" ADD CONSTRAINT "docker_container_folder_assignments_folder_id_docker_container_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."docker_container_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "docker_container_folder_parent_idx" ON "docker_container_folders" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "docker_container_folder_sort_idx" ON "docker_container_folders" USING btree ("parent_id","sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "docker_container_folder_compose_unique_idx" ON "docker_container_folders" USING btree ("node_id","compose_project");
--> statement-breakpoint
CREATE UNIQUE INDEX "docker_container_folder_assignment_node_name_idx" ON "docker_container_folder_assignments" USING btree ("node_id","container_name");
--> statement-breakpoint
CREATE INDEX "docker_container_folder_assignment_folder_idx" ON "docker_container_folder_assignments" USING btree ("folder_id","sort_order");
