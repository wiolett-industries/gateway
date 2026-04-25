CREATE TYPE "public"."status_page_incident_update_status" AS ENUM('update', 'investigating', 'identified', 'monitoring', 'resolved');
--> statement-breakpoint
CREATE TABLE "status_page_incident_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" "status_page_incident_update_status" DEFAULT 'update' NOT NULL,
	"message" text NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "status_page_incident_updates" ADD CONSTRAINT "status_page_incident_updates_incident_id_status_page_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."status_page_incidents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_page_incident_updates" ADD CONSTRAINT "status_page_incident_updates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "status_page_incident_updates_incident_idx" ON "status_page_incident_updates" USING btree ("incident_id");
--> statement-breakpoint
CREATE INDEX "status_page_incident_updates_created_idx" ON "status_page_incident_updates" USING btree ("created_at");
