CREATE TABLE "node_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "database_connection_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "node_folders" ADD CONSTRAINT "node_folders_parent_id_node_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."node_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "node_folders" ADD CONSTRAINT "node_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "database_connection_folders" ADD CONSTRAINT "database_connection_folders_parent_id_database_connection_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."database_connection_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "database_connection_folders" ADD CONSTRAINT "database_connection_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "folder_id" uuid;
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "database_connections" ADD COLUMN "folder_id" uuid;
--> statement-breakpoint
ALTER TABLE "database_connections" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_folder_id_node_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."node_folders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "database_connections" ADD CONSTRAINT "database_connections_folder_id_database_connection_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."database_connection_folders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "node_folder_parent_idx" ON "node_folders" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "node_folder_sort_idx" ON "node_folders" USING btree ("parent_id","sort_order");
--> statement-breakpoint
CREATE INDEX "database_connection_folder_parent_idx" ON "database_connection_folders" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "database_connection_folder_sort_idx" ON "database_connection_folders" USING btree ("parent_id","sort_order");
--> statement-breakpoint
CREATE INDEX "node_folder_idx" ON "nodes" USING btree ("folder_id");
--> statement-breakpoint
CREATE INDEX "database_connections_folder_idx" ON "database_connections" USING btree ("folder_id");
