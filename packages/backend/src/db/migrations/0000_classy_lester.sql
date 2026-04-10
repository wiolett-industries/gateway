CREATE TYPE "public"."alert_type" AS ENUM('expiry_warning', 'expiry_critical', 'ca_expiry', 'revocation');--> statement-breakpoint
CREATE TYPE "public"."ca_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ca_type" AS ENUM('root', 'intermediate');--> statement-breakpoint
CREATE TYPE "public"."key_algorithm" AS ENUM('rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384');--> statement-breakpoint
CREATE TYPE "public"."cert_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."cert_type" AS ENUM('tls-server', 'tls-client', 'code-signing', 'email');--> statement-breakpoint
CREATE TYPE "public"."dns_status" AS ENUM('valid', 'invalid', 'pending', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."node_status" AS ENUM('pending', 'online', 'offline', 'error');--> statement-breakpoint
CREATE TYPE "public"."node_type" AS ENUM('nginx', 'bastion', 'monitoring', 'docker');--> statement-breakpoint
CREATE TYPE "public"."forward_scheme" AS ENUM('http', 'https');--> statement-breakpoint
CREATE TYPE "public"."health_status" AS ENUM('online', 'offline', 'degraded', 'unknown', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."proxy_host_type" AS ENUM('proxy', 'redirect', '404', 'raw');--> statement-breakpoint
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
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "alert_type" NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" uuid NOT NULL,
	"message" text NOT NULL,
	"dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" varchar(20) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" uuid,
	"details" jsonb,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificate_authorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"type" "ca_type" NOT NULL,
	"status" "ca_status" DEFAULT 'active' NOT NULL,
	"common_name" varchar(255) NOT NULL,
	"key_algorithm" "key_algorithm" NOT NULL,
	"serial_number" varchar(255) NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"encrypted_dek" text NOT NULL,
	"dek_iv" text NOT NULL,
	"certificate_pem" text NOT NULL,
	"subject_dn" text NOT NULL,
	"issuer_dn" text,
	"path_length_constraint" integer,
	"max_validity_days" integer DEFAULT 365 NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"ocsp_cert_pem" text,
	"encrypted_ocsp_key" text,
	"encrypted_ocsp_dek" text,
	"ocsp_dek_iv" text,
	"crl_distribution_url" varchar(500),
	"ocsp_responder_url" varchar(500),
	"ca_issuers_url" varchar(500),
	"crl_number" integer DEFAULT 0 NOT NULL,
	"last_crl_at" timestamp with time zone,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(50)
);
--> statement-breakpoint
CREATE TABLE "certificate_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"cert_type" "cert_type" NOT NULL,
	"key_algorithm" "key_algorithm" DEFAULT 'ecdsa-p256' NOT NULL,
	"validity_days" integer DEFAULT 365 NOT NULL,
	"key_usage" jsonb NOT NULL,
	"ext_key_usage" jsonb NOT NULL,
	"require_sans" boolean DEFAULT true NOT NULL,
	"san_types" jsonb DEFAULT '["dns","ip"]'::jsonb,
	"subject_dn_fields" jsonb DEFAULT '{}'::jsonb,
	"crl_distribution_points" jsonb DEFAULT '[]'::jsonb,
	"authority_info_access" jsonb DEFAULT '{}'::jsonb,
	"certificate_policies" jsonb DEFAULT '[]'::jsonb,
	"custom_extensions" jsonb DEFAULT '[]'::jsonb,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ca_id" uuid NOT NULL,
	"template_id" uuid,
	"status" "cert_status" DEFAULT 'active' NOT NULL,
	"type" "cert_type" NOT NULL,
	"common_name" varchar(255) NOT NULL,
	"sans" jsonb DEFAULT '[]'::jsonb,
	"serial_number" varchar(255) NOT NULL,
	"certificate_pem" text NOT NULL,
	"encrypted_private_key" text,
	"encrypted_dek" text,
	"dek_iv" text,
	"key_algorithm" "key_algorithm" NOT NULL,
	"subject_dn" text NOT NULL,
	"issuer_dn" text NOT NULL,
	"not_before" timestamp with time zone NOT NULL,
	"not_after" timestamp with time zone NOT NULL,
	"csr_pem" text,
	"server_generated" boolean DEFAULT false NOT NULL,
	"key_usage" jsonb DEFAULT '[]'::jsonb,
	"ext_key_usage" jsonb DEFAULT '[]'::jsonb,
	"revoked_at" timestamp with time zone,
	"revocation_reason" varchar(50),
	"issued_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docker_registries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"username" text,
	"encrypted_password" text,
	"scope" text DEFAULT 'global' NOT NULL,
	"node_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "docker_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"container_name" text NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_secret_unique" UNIQUE("node_id","container_name","key")
);
--> statement-breakpoint
CREATE TABLE "docker_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"container_name" text NOT NULL,
	"token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cleanup_enabled" boolean DEFAULT false NOT NULL,
	"retention_count" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_webhooks_node_id_container_name_unique" UNIQUE("node_id","container_name")
);
--> statement-breakpoint
CREATE TABLE "docker_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"container_id" text,
	"container_name" text,
	"type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"progress" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "docker_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"config" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "docker_templates_name_unique" UNIQUE("name")
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
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "node_type" DEFAULT 'nginx' NOT NULL,
	"hostname" varchar(255) NOT NULL,
	"display_name" varchar(255),
	"status" "node_status" DEFAULT 'pending' NOT NULL,
	"enrollment_token_hash" varchar(255),
	"certificate_serial" varchar(255),
	"certificate_expires_at" timestamp with time zone,
	"daemon_version" varchar(50),
	"os_info" varchar(255),
	"config_version_hash" varchar(64),
	"capabilities" jsonb DEFAULT '{}'::jsonb,
	"last_seen_at" timestamp with time zone,
	"last_health_report" jsonb,
	"last_stats_report" jsonb,
	"health_history" jsonb DEFAULT '[]'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"parent_id" uuid,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
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
	"raw_config" text,
	"raw_config_enabled" boolean DEFAULT false NOT NULL,
	"folder_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"nginx_template_id" uuid,
	"template_variables" jsonb DEFAULT '{}'::jsonb,
	"access_list_id" uuid,
	"node_id" uuid,
	"health_check_enabled" boolean DEFAULT false NOT NULL,
	"health_check_url" varchar(500) DEFAULT '/',
	"health_check_interval" integer DEFAULT 30,
	"health_check_expected_status" integer,
	"health_check_expected_body" varchar(500),
	"health_status" "health_status" DEFAULT 'unknown',
	"last_health_check_at" timestamp with time zone,
	"health_history" jsonb DEFAULT '[]'::jsonb,
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
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_subject" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"avatar_url" text,
	"group_id" uuid NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_lists" ADD CONSTRAINT "access_lists_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_authorities" ADD CONSTRAINT "certificate_authorities_parent_id_certificate_authorities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."certificate_authorities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_authorities" ADD CONSTRAINT "certificate_authorities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_ca_id_certificate_authorities_id_fk" FOREIGN KEY ("ca_id") REFERENCES "public"."certificate_authorities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_template_id_certificate_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_registries" ADD CONSTRAINT "docker_registries_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_secrets" ADD CONSTRAINT "docker_secrets_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_webhooks" ADD CONSTRAINT "docker_webhooks_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_tasks" ADD CONSTRAINT "docker_tasks_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docker_templates" ADD CONSTRAINT "docker_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nginx_templates" ADD CONSTRAINT "nginx_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_host_folders" ADD CONSTRAINT "proxy_host_folders_parent_id_proxy_host_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."proxy_host_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_host_folders" ADD CONSTRAINT "proxy_host_folders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_ssl_certificate_id_ssl_certificates_id_fk" FOREIGN KEY ("ssl_certificate_id") REFERENCES "public"."ssl_certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_internal_certificate_id_certificates_id_fk" FOREIGN KEY ("internal_certificate_id") REFERENCES "public"."certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_folder_id_proxy_host_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."proxy_host_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_nginx_template_id_nginx_templates_id_fk" FOREIGN KEY ("nginx_template_id") REFERENCES "public"."nginx_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_access_list_id_access_lists_id_fk" FOREIGN KEY ("access_list_id") REFERENCES "public"."access_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_internal_cert_id_certificates_id_fk" FOREIGN KEY ("internal_cert_id") REFERENCES "public"."certificates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD CONSTRAINT "ssl_certificates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_group_id_permission_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."permission_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_resource_idx" ON "alerts" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "alert_dismissed_idx" ON "alerts" USING btree ("dismissed");--> statement-breakpoint
CREATE INDEX "alert_type_idx" ON "alerts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_tokens_token_hash_idx" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ca_parent_idx" ON "certificate_authorities" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ca_status_idx" ON "certificate_authorities" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "ca_serial_idx" ON "certificate_authorities" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "ca_created_by_idx" ON "certificate_authorities" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "cert_ca_idx" ON "certificates" USING btree ("ca_id");--> statement-breakpoint
CREATE INDEX "cert_status_idx" ON "certificates" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "cert_serial_idx" ON "certificates" USING btree ("serial_number");--> statement-breakpoint
CREATE INDEX "cert_cn_idx" ON "certificates" USING btree ("common_name");--> statement-breakpoint
CREATE INDEX "cert_type_idx" ON "certificates" USING btree ("type");--> statement-breakpoint
CREATE INDEX "cert_not_after_idx" ON "certificates" USING btree ("not_after");--> statement-breakpoint
CREATE INDEX "cert_issued_by_idx" ON "certificates" USING btree ("issued_by_id");--> statement-breakpoint
CREATE INDEX "docker_secret_container_idx" ON "docker_secrets" USING btree ("node_id","container_name");--> statement-breakpoint
CREATE UNIQUE INDEX "docker_webhooks_token_idx" ON "docker_webhooks" USING btree ("token");--> statement-breakpoint
CREATE INDEX "domain_domain_idx" ON "domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "domain_dns_status_idx" ON "domains" USING btree ("dns_status");--> statement-breakpoint
CREATE INDEX "domain_created_by_idx" ON "domains" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "node_type_idx" ON "nodes" USING btree ("type");--> statement-breakpoint
CREATE INDEX "node_status_idx" ON "nodes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "node_hostname_idx" ON "nodes" USING btree ("hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "permission_groups_name_idx" ON "permission_groups" USING btree ("name");--> statement-breakpoint
CREATE INDEX "permission_groups_parent_id_idx" ON "permission_groups" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "proxy_host_folder_parent_idx" ON "proxy_host_folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "proxy_host_folder_sort_idx" ON "proxy_host_folders" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "proxy_host_enabled_idx" ON "proxy_hosts" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "proxy_host_type_idx" ON "proxy_hosts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "proxy_host_folder_idx" ON "proxy_hosts" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "proxy_host_created_by_idx" ON "proxy_hosts" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "proxy_host_node_idx" ON "proxy_hosts" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "ssl_cert_status_idx" ON "ssl_certificates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ssl_cert_not_after_idx" ON "ssl_certificates" USING btree ("not_after");--> statement-breakpoint
CREATE INDEX "ssl_cert_type_idx" ON "ssl_certificates" USING btree ("type");--> statement-breakpoint
CREATE INDEX "ssl_cert_created_by_idx" ON "ssl_certificates" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_oidc_subject_idx" ON "users" USING btree ("oidc_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_group_id_idx" ON "users" USING btree ("group_id");