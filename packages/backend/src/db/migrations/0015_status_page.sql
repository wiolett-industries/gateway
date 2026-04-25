CREATE TYPE "public"."status_page_source_type" AS ENUM('node', 'proxy_host', 'database');
--> statement-breakpoint
CREATE TYPE "public"."status_page_incident_severity" AS ENUM('info', 'warning', 'critical');
--> statement-breakpoint
CREATE TYPE "public"."status_page_incident_status" AS ENUM('active', 'resolved');
--> statement-breakpoint
CREATE TYPE "public"."status_page_incident_type" AS ENUM('automatic', 'manual');
--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "system_kind" varchar(50);
--> statement-breakpoint
CREATE TABLE "status_page_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "status_page_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"public_name" varchar(255) NOT NULL,
	"public_description" text,
	"public_group" varchar(255),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"create_threshold_seconds" integer DEFAULT 600 NOT NULL,
	"resolve_threshold_seconds" integer DEFAULT 60 NOT NULL,
	"last_evaluated_status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"unhealthy_since" timestamp with time zone,
	"healthy_since" timestamp with time zone,
	"created_by_id" uuid NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "status_page_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"severity" "status_page_incident_severity" DEFAULT 'warning' NOT NULL,
	"status" "status_page_incident_status" DEFAULT 'active' NOT NULL,
	"type" "status_page_incident_type" DEFAULT 'manual' NOT NULL,
	"auto_managed" boolean DEFAULT false NOT NULL,
	"affected_service_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"resolved_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "status_page_services" ADD CONSTRAINT "status_page_services_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_page_services" ADD CONSTRAINT "status_page_services_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_page_incidents" ADD CONSTRAINT "status_page_incidents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_page_incidents" ADD CONSTRAINT "status_page_incidents_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "status_page_incidents" ADD CONSTRAINT "status_page_incidents_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "proxy_host_system_kind_idx" ON "proxy_hosts" USING btree ("system_kind");
--> statement-breakpoint
CREATE INDEX "status_page_services_source_idx" ON "status_page_services" USING btree ("source_type","source_id");
--> statement-breakpoint
CREATE INDEX "status_page_services_enabled_idx" ON "status_page_services" USING btree ("enabled");
--> statement-breakpoint
CREATE INDEX "status_page_services_sort_idx" ON "status_page_services" USING btree ("sort_order");
--> statement-breakpoint
CREATE INDEX "status_page_incidents_status_idx" ON "status_page_incidents" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "status_page_incidents_type_idx" ON "status_page_incidents" USING btree ("type");
--> statement-breakpoint
CREATE INDEX "status_page_incidents_started_idx" ON "status_page_incidents" USING btree ("started_at");
