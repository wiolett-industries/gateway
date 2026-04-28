CREATE TABLE IF NOT EXISTS "logging_metadata" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "environment_id" uuid NOT NULL,
  "kind" varchar(40) NOT NULL,
  "key" varchar(255) NOT NULL,
  "value" text DEFAULT '' NOT NULL,
  "count" integer DEFAULT 0 NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "logging_metadata_environment_id_logging_environments_id_fk"
    FOREIGN KEY ("environment_id") REFERENCES "logging_environments"("id") ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE "logging_metadata" ALTER COLUMN "value" SET DEFAULT '';
--> statement-breakpoint
UPDATE "logging_metadata" SET "value" = '' WHERE "value" IS NULL;
--> statement-breakpoint
ALTER TABLE "logging_metadata" ALTER COLUMN "value" SET NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "logging_metadata_unique_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "logging_metadata_unique_idx"
  ON "logging_metadata" ("environment_id", "kind", "key", "value");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logging_metadata_env_kind_idx"
  ON "logging_metadata" ("environment_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "logging_metadata_env_kind_key_value_idx"
  ON "logging_metadata" ("environment_id", "kind", "key", "value");
