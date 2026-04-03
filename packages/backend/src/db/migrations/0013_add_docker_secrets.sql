CREATE TABLE IF NOT EXISTS "docker_secrets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" uuid NOT NULL REFERENCES "nodes"("id") ON DELETE CASCADE,
  "container_name" text NOT NULL,
  "key" text NOT NULL,
  "encrypted_value" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "docker_secret_unique" UNIQUE ("node_id", "container_name", "key")
);
CREATE INDEX IF NOT EXISTS "docker_secret_container_idx" ON "docker_secrets"("node_id", "container_name");
