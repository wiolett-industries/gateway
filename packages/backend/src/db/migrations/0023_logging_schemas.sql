CREATE TABLE IF NOT EXISTS "logging_schemas" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(255) NOT NULL,
  "slug" varchar(120) NOT NULL,
  "description" text,
  "schema_mode" varchar(20) DEFAULT 'reject' NOT NULL,
  "field_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_by_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "logging_schemas_slug_unique" UNIQUE("slug"),
  CONSTRAINT "logging_schemas_created_by_id_users_id_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE "logging_environments"
  ADD COLUMN IF NOT EXISTS "schema_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "logging_environments"
    ADD CONSTRAINT "logging_environments_schema_id_logging_schemas_id_fk"
      FOREIGN KEY ("schema_id") REFERENCES "logging_schemas"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logging_schema_slug_idx" ON "logging_schemas" ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logging_env_schema_idx" ON "logging_environments" ("schema_id");
