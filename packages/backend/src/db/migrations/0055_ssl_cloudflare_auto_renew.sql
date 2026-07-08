ALTER TABLE "ssl_certificates" ADD COLUMN "auto_renew_provider" varchar(50);--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD COLUMN "auto_renew_dns_bindings" jsonb;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD COLUMN "auto_renew_disabled_reason" text;--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD COLUMN "auto_renew_disabled_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ssl_cert_auto_renew_provider_idx" ON "ssl_certificates" USING btree ("auto_renew_provider");
