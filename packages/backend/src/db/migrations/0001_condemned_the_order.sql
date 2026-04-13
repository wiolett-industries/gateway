CREATE TABLE "notification_alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"type" varchar(20) NOT NULL,
	"severity" varchar(20) DEFAULT 'warning' NOT NULL,
	"category" varchar(20) NOT NULL,
	"metric" varchar(100),
	"operator" varchar(5),
	"threshold_value" double precision,
	"duration_seconds" integer DEFAULT 0,
	"event_pattern" varchar(255),
	"resource_ids" jsonb DEFAULT '[]'::jsonb,
	"message_template" text,
	"webhook_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cooldown_seconds" integer DEFAULT 900 NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_alert_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'firing' NOT NULL,
	"severity" varchar(20) NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"last_notified_at" timestamp with time zone DEFAULT now() NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"request_url" text NOT NULL,
	"request_method" varchar(10) NOT NULL,
	"request_body" text,
	"response_status" integer,
	"response_body" text,
	"response_time_ms" integer,
	"attempt" integer DEFAULT 1 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notification_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"method" varchar(10) DEFAULT 'POST' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"signing_secret" text,
	"signing_header" varchar(100) DEFAULT 'X-Signature-256',
	"template_preset" varchar(50),
	"body_template" text,
	"headers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_alert_states" ADD CONSTRAINT "notification_alert_states_rule_id_notification_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."notification_alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_log" ADD CONSTRAINT "notification_delivery_log_webhook_id_notification_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."notification_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notif_alert_rules_enabled_idx" ON "notification_alert_rules" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "notif_alert_rules_type_idx" ON "notification_alert_rules" USING btree ("type");--> statement-breakpoint
CREATE INDEX "notif_alert_rules_category_idx" ON "notification_alert_rules" USING btree ("category");--> statement-breakpoint
CREATE INDEX "notif_alert_rules_builtin_idx" ON "notification_alert_rules" USING btree ("is_builtin");--> statement-breakpoint
CREATE INDEX "notif_alert_states_rule_idx" ON "notification_alert_states" USING btree ("rule_id");--> statement-breakpoint
CREATE INDEX "notif_alert_states_status_idx" ON "notification_alert_states" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notif_alert_states_resource_idx" ON "notification_alert_states" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "notif_delivery_log_webhook_idx" ON "notification_delivery_log" USING btree ("webhook_id");--> statement-breakpoint
CREATE INDEX "notif_delivery_log_status_idx" ON "notification_delivery_log" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notif_delivery_log_retry_idx" ON "notification_delivery_log" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "notif_delivery_log_created_idx" ON "notification_delivery_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notif_webhooks_enabled_idx" ON "notification_webhooks" USING btree ("enabled");