ALTER TABLE "docker_container_folders" ADD COLUMN "resource_type" varchar(32) DEFAULT 'container' NOT NULL;
--> statement-breakpoint
ALTER TABLE "docker_container_folder_assignments" ADD COLUMN "resource_type" varchar(32) DEFAULT 'container' NOT NULL;
--> statement-breakpoint
ALTER TABLE "docker_container_folder_assignments" ADD COLUMN "resource_key" varchar(512);
--> statement-breakpoint
UPDATE "docker_container_folder_assignments" SET "resource_key" = "container_name" WHERE "resource_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "docker_container_folder_assignments" ALTER COLUMN "resource_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "docker_container_folder_assignments" ALTER COLUMN "container_name" DROP NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "docker_container_folder_parent_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "docker_container_folder_sort_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "docker_container_folder_compose_unique_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "docker_container_folder_assignment_node_name_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "docker_container_folder_assignment_folder_idx";
--> statement-breakpoint
CREATE INDEX "docker_container_folder_parent_idx" ON "docker_container_folders" USING btree ("resource_type","parent_id");
--> statement-breakpoint
CREATE INDEX "docker_container_folder_sort_idx" ON "docker_container_folders" USING btree ("resource_type","parent_id","sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "docker_container_folder_compose_unique_idx" ON "docker_container_folders" USING btree ("node_id","resource_type","compose_project");
--> statement-breakpoint
CREATE UNIQUE INDEX "docker_container_folder_assignment_node_resource_idx" ON "docker_container_folder_assignments" USING btree ("node_id","resource_type","resource_key");
--> statement-breakpoint
CREATE INDEX "docker_container_folder_assignment_folder_idx" ON "docker_container_folder_assignments" USING btree ("resource_type","folder_id","sort_order");
