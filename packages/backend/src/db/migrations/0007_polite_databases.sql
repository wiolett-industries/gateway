CREATE TYPE "public"."database_type" AS ENUM('postgres', 'redis');
--> statement-breakpoint
CREATE TYPE "public"."database_health_status" AS ENUM('online', 'offline', 'degraded', 'unknown');
--> statement-breakpoint
CREATE TABLE "database_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "database_type" NOT NULL,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"host" varchar(255) NOT NULL,
	"port" integer NOT NULL,
	"database_name" varchar(255),
	"username" varchar(255),
	"tls_enabled" boolean DEFAULT false NOT NULL,
	"encrypted_config" text NOT NULL,
	"health_status" "database_health_status" DEFAULT 'unknown' NOT NULL,
	"last_health_check_at" timestamp with time zone,
	"last_error" text,
	"health_history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "database_connections" ADD CONSTRAINT "database_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "database_connections" ADD CONSTRAINT "database_connections_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "database_connections_type_idx" ON "database_connections" USING btree ("type");
--> statement-breakpoint
CREATE INDEX "database_connections_health_idx" ON "database_connections" USING btree ("health_status");
--> statement-breakpoint
CREATE INDEX "database_connections_created_by_idx" ON "database_connections" USING btree ("created_by_id");
--> statement-breakpoint
CREATE INDEX "database_connections_updated_by_idx" ON "database_connections" USING btree ("updated_by_id");
