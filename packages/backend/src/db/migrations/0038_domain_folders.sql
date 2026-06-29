CREATE TABLE "domain_folders" (
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
ALTER TABLE "domain_folders" ADD CONSTRAINT "domain_folders_parent_id_domain_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."domain_folders"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "domain_folders" ADD CONSTRAINT "domain_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "folder_id" uuid;
--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_folder_id_domain_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."domain_folders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "domain_folder_parent_idx" ON "domain_folders" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "domain_folder_sort_idx" ON "domain_folders" USING btree ("parent_id","sort_order");
--> statement-breakpoint
CREATE INDEX "domain_folder_idx" ON "domains" USING btree ("folder_id");
