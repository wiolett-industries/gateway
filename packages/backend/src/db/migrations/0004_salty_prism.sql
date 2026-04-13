ALTER TABLE "notification_delivery_log" ALTER COLUMN "status" SET DEFAULT 'retrying';--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "health_check_slow_threshold" integer DEFAULT 3;