CREATE TABLE "logging_environment_folders" (
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
CREATE TABLE "logging_schema_folders" (
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
CREATE TABLE "admin_user_folders" (
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
CREATE TABLE "permission_group_folders" (
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
ALTER TABLE "logging_environment_folders" ADD CONSTRAINT "logging_environment_folders_parent_id_logging_environment_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."logging_environment_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logging_environment_folders" ADD CONSTRAINT "logging_environment_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logging_schema_folders" ADD CONSTRAINT "logging_schema_folders_parent_id_logging_schema_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."logging_schema_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logging_schema_folders" ADD CONSTRAINT "logging_schema_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "admin_user_folders" ADD CONSTRAINT "admin_user_folders_parent_id_admin_user_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."admin_user_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "admin_user_folders" ADD CONSTRAINT "admin_user_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "permission_group_folders" ADD CONSTRAINT "permission_group_folders_parent_id_permission_group_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."permission_group_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "permission_group_folders" ADD CONSTRAINT "permission_group_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logging_environments" ADD COLUMN "folder_id" uuid;
--> statement-breakpoint
ALTER TABLE "logging_environments" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "logging_schemas" ADD COLUMN "folder_id" uuid;
--> statement-breakpoint
ALTER TABLE "logging_schemas" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "folder_id" uuid;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "permission_groups" ADD COLUMN "folder_id" uuid;
--> statement-breakpoint
ALTER TABLE "permission_groups" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "logging_environments" ADD CONSTRAINT "logging_environments_folder_id_logging_environment_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."logging_environment_folders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "logging_schemas" ADD CONSTRAINT "logging_schemas_folder_id_logging_schema_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."logging_schema_folders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_folder_id_admin_user_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."admin_user_folders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "permission_groups" ADD CONSTRAINT "permission_groups_folder_id_permission_group_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."permission_group_folders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "logging_environment_folder_parent_idx" ON "logging_environment_folders" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "logging_environment_folder_sort_idx" ON "logging_environment_folders" USING btree ("parent_id","sort_order");
--> statement-breakpoint
CREATE INDEX "logging_schema_folder_parent_idx" ON "logging_schema_folders" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "logging_schema_folder_sort_idx" ON "logging_schema_folders" USING btree ("parent_id","sort_order");
--> statement-breakpoint
CREATE INDEX "admin_user_folder_parent_idx" ON "admin_user_folders" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "admin_user_folder_sort_idx" ON "admin_user_folders" USING btree ("parent_id","sort_order");
--> statement-breakpoint
CREATE INDEX "permission_group_folder_parent_idx" ON "permission_group_folders" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "permission_group_folder_sort_idx" ON "permission_group_folders" USING btree ("parent_id","sort_order");
--> statement-breakpoint
CREATE INDEX "logging_environments_folder_idx" ON "logging_environments" USING btree ("folder_id");
--> statement-breakpoint
CREATE INDEX "logging_schemas_folder_idx" ON "logging_schemas" USING btree ("folder_id");
--> statement-breakpoint
CREATE INDEX "users_folder_idx" ON "users" USING btree ("folder_id");
--> statement-breakpoint
CREATE INDEX "permission_groups_folder_idx" ON "permission_groups" USING btree ("folder_id");
