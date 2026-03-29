CREATE TYPE "public"."dns_status" AS ENUM('valid', 'invalid', 'pending', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."forward_scheme" AS ENUM('http', 'https');--> statement-breakpoint
CREATE TYPE "public"."health_status" AS ENUM('online', 'offline', 'degraded', 'unknown', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."proxy_host_type" AS ENUM('proxy', 'redirect', '404');--> statement-breakpoint
CREATE TYPE "public"."acme_challenge_type" AS ENUM('http-01', 'dns-01');--> statement-breakpoint
CREATE TYPE "public"."ssl_cert_status" AS ENUM('active', 'expired', 'pending', 'error');--> statement-breakpoint
CREATE TYPE "public"."ssl_cert_type" AS ENUM('acme', 'upload', 'internal');--> statement-breakpoint
CREATE TABLE "access_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"ip_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"basic_auth_enabled" boolean DEFAULT false NOT NULL,
	"basic_auth_users" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" varchar(253) NOT NULL,
	"description" text,
	"dns_status" "dns_status" DEFAULT 'pending' NOT NULL,
	"last_dns_check_at" timestamp with time zone,
	"dns_records" jsonb,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "nginx_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"type" "proxy_host_type" NOT NULL,
	"content" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proxy_host_folders" (
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
CREATE TABLE "proxy_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "proxy_host_type" DEFAULT 'proxy' NOT NULL,
	"domain_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"forward_host" varchar(255),
	"forward_port" integer,
	"forward_scheme" "forward_scheme" DEFAULT 'http',
	"ssl_enabled" boolean DEFAULT false NOT NULL,
	"ssl_forced" boolean DEFAULT false NOT NULL,
	"http2_support" boolean DEFAULT true NOT NULL,
	"ssl_certificate_id" uuid,
	"internal_certificate_id" uuid,
	"websocket_support" boolean DEFAULT false NOT NULL,
	"redirect_url" text,
	"redirect_status_code" integer DEFAULT 301,
	"custom_headers" jsonb DEFAULT '[]'::jsonb,
	"cache_enabled" boolean DEFAULT false NOT NULL,
	"cache_options" jsonb,
	"rate_limit_enabled" boolean DEFAULT false NOT NULL,
	"rate_limit_options" jsonb,
	"custom_rewrites" jsonb DEFAULT '[]'::jsonb,
	"advanced_config" text,
	"folder_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"nginx_template_id" uuid,
	"template_variables" jsonb DEFAULT '{}'::jsonb,
	"access_list_id" uuid,
	"health_check_enabled" boolean DEFAULT false NOT NULL,
	"health_check_url" varchar(500) DEFAULT '/',
	"health_check_interval" integer DEFAULT 30,
	"health_check_expected_status" integer,
	"health_check_expected_body" varchar(500),
	"health_status" "health_status" DEFAULT 'unknown',
	"last_health_check_at" timestamp with time zone,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssl_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "ssl_cert_type" NOT NULL,
	"domain_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certificate_pem" text,
	"private_key_pem" text,
	"encrypted_dek" text,
	"dek_iv" text,
	"chain_pem" text,
	"acme_provider" varchar(50),
	"acme_challenge_type" "acme_challenge_type",
	"acme_account_key" text,
	"acme_order_url" text,
	"internal_cert_id" uuid,
	"not_before" timestamp with time zone,
	"not_after" timestamp with time zone,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"last_renewed_at" timestamp with time zone,
	"renewal_error" text,
	"status" "ssl_cert_status" DEFAULT 'pending' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "certificate_authorities" ADD COLUMN "crl_distribution_url" varchar(500);--> statement-breakpoint
ALTER TABLE "certificate_authorities" ADD COLUMN "ocsp_responder_url" varchar(500);--> statement-breakpoint
ALTER TABLE "certificate_authorities" ADD COLUMN "ca_issuers_url" varchar(500);--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "subject_dn_fields" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "crl_distribution_points" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "authority_info_access" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "certificate_policies" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD COLUMN "custom_extensions" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "access_lists" ADD CONSTRAINT "access_lists_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nginx_templates" ADD CONSTRAINT "nginx_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_host_folders" ADD CONSTRAINT "proxy_host_folders_parent_id_proxy_host_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."proxy_host_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_host_folders" ADD CONSTRAINT "proxy_host_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_ssl_certificate_id_ssl_certificates_id_fk" FOREIGN KEY ("ssl_certificate_id") REFERENCES "public"."ssl_certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_internal_certificate_id_certificates_id_fk" FOREIGN KEY ("internal_certificate_id") REFERENCES "public"."certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_folder_id_proxy_host_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."proxy_host_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_nginx_template_id_nginx_templates_id_fk" FOREIGN KEY ("nginx_template_id") REFERENCES "public"."nginx_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_access_list_id_access_lists_id_fk" FOREIGN KEY ("access_list_id") REFERENCES "public"."access_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_internal_cert_id_certificates_id_fk" FOREIGN KEY ("internal_cert_id") REFERENCES "public"."certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "domain_domain_idx" ON "domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domain_dns_status_idx" ON "domains" USING btree ("dns_status");--> statement-breakpoint
CREATE INDEX "domain_created_by_idx" ON "domains" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "proxy_host_folder_parent_idx" ON "proxy_host_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "proxy_host_folder_sort_idx" ON "proxy_host_folders" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "proxy_host_enabled_idx" ON "proxy_hosts" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "proxy_host_type_idx" ON "proxy_hosts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "proxy_host_folder_idx" ON "proxy_hosts" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "proxy_host_created_by_idx" ON "proxy_hosts" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "ssl_cert_status_idx" ON "ssl_certificates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ssl_cert_not_after_idx" ON "ssl_certificates" USING btree ("not_after");--> statement-breakpoint
CREATE INDEX "ssl_cert_type_idx" ON "ssl_certificates" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ssl_cert_created_by_idx" ON "ssl_certificates" USING btree ("created_by_id");--> statement-breakpoint
ALTER TABLE "api_tokens" DROP COLUMN "permission";--> statement-breakpoint
DROP TYPE "public"."api_token_permission";