CREATE TYPE "public"."user_role" AS ENUM('admin', 'operator', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."api_token_permission" AS ENUM('read', 'read-write');--> statement-breakpoint
CREATE TYPE "public"."ca_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ca_type" AS ENUM('root', 'intermediate');--> statement-breakpoint
CREATE TYPE "public"."key_algorithm" AS ENUM('rsa-2048', 'rsa-4096', 'ecdsa-p256', 'ecdsa-p384');--> statement-breakpoint
CREATE TYPE "public"."cert_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."cert_type" AS ENUM('tls-server', 'tls-client', 'code-signing', 'email');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('expiry_warning', 'expiry_critical', 'ca_expiry', 'revocation');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"oidc_subject" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"avatar_url" text,
	"role" "user_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" varchar(20) NOT NULL,
	"permission" "api_token_permission" DEFAULT 'read-write' NOT NULL,
	"last_used_at" timestamp with time zone,
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
	"crl_number" integer DEFAULT 0 NOT NULL,
	"last_crl_at" timestamp with time zone,
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
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_authorities" ADD CONSTRAINT "certificate_authorities_parent_id_certificate_authorities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."certificate_authorities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_authorities" ADD CONSTRAINT "certificate_authorities_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_templates" ADD CONSTRAINT "certificate_templates_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_ca_id_certificate_authorities_id_fk" FOREIGN KEY ("ca_id") REFERENCES "public"."certificate_authorities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_template_id_certificate_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_oidc_subject_idx" ON "users" USING btree ("oidc_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "api_tokens_user_idx" ON "api_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "api_tokens_token_hash_idx" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
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
CREATE INDEX "audit_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_log" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "alert_resource_idx" ON "alerts" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "alert_dismissed_idx" ON "alerts" USING btree ("dismissed");--> statement-breakpoint
CREATE INDEX "alert_type_idx" ON "alerts" USING btree ("type");