CREATE TYPE "domain_dns_provider" AS ENUM('legacy', 'cloudflare');--> statement-breakpoint
CREATE TYPE "domain_dns_ownership" AS ENUM('legacy', 'created', 'matched_existing', 'overwritten');--> statement-breakpoint
CREATE TABLE "integration_connector_cloudflare_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"remote_id" varchar(128) NOT NULL,
	"name" text NOT NULL,
	"status" varchar(64),
	"account_id" varchar(128),
	"account_name" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_cloudflare_zone_connector_remote_unique" UNIQUE("connector_id","remote_id"),
	CONSTRAINT "integration_cloudflare_zone_connector_name_unique" UNIQUE("connector_id","name")
);--> statement-breakpoint
ALTER TABLE "integration_connector_cloudflare_zones" ADD CONSTRAINT "integration_connector_cloudflare_zones_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_cloudflare_zone_connector_idx" ON "integration_connector_cloudflare_zones" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "integration_cloudflare_zone_name_idx" ON "integration_connector_cloudflare_zones" USING btree ("name");--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "dns_provider" "domain_dns_provider" DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "dns_ownership" "domain_dns_ownership" DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "integration_connector_id" uuid;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "provider_zone_id" varchar(128);--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "provider_zone_name" text;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "provider_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "dns_record_type" varchar(16);--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "dns_target_ips" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "dns_ttl" integer;--> statement-breakpoint
ALTER TABLE "domains" ADD COLUMN "dns_proxied" boolean;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_integration_connector_id_integration_connectors_id_fk" FOREIGN KEY ("integration_connector_id") REFERENCES "public"."integration_connectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_dns_provider_idx" ON "domains" USING btree ("dns_provider");--> statement-breakpoint
CREATE INDEX "domain_integration_connector_idx" ON "domains" USING btree ("integration_connector_id");
