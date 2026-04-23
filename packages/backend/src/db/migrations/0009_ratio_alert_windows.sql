ALTER TABLE "notification_alert_rules" ADD COLUMN "fire_threshold_percent" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_alert_rules" ADD COLUMN "resolve_threshold_percent" integer DEFAULT 100 NOT NULL;
