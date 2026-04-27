CREATE TABLE IF NOT EXISTS "logging_environments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "slug" varchar(120) NOT NULL,
  "description" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "schema_mode" varchar(20) DEFAULT 'reject' NOT NULL,
  "retention_days" integer DEFAULT 30 NOT NULL,
  "rate_limit_requests_per_window" integer,
  "rate_limit_events_per_window" integer,
  "field_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "logging_environments_slug_unique" UNIQUE("slug"),
  CONSTRAINT "logging_environments_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "logging_ingest_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "environment_id" uuid NOT NULL,
  "name" varchar(255) NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" varchar(20) NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "logging_ingest_tokens_environment_id_logging_environments_id_fk"
    FOREIGN KEY ("environment_id") REFERENCES "logging_environments"("id") ON DELETE cascade,
  CONSTRAINT "logging_ingest_tokens_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logging_env_slug_idx" ON "logging_environments" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logging_env_enabled_idx" ON "logging_environments" ("enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logging_token_env_idx" ON "logging_ingest_tokens" ("environment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logging_token_hash_idx" ON "logging_ingest_tokens" ("token_hash");
