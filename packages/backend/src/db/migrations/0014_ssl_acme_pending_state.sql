ALTER TABLE "ssl_certificates" ADD COLUMN "acme_pending_operation" varchar(20);
--> statement-breakpoint
ALTER TABLE "ssl_certificates" ADD COLUMN "acme_pending_challenges" jsonb;
