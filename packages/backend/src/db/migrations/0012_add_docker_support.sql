ALTER TYPE "public"."node_type" ADD VALUE IF NOT EXISTS 'docker';

CREATE TABLE IF NOT EXISTS "docker_registries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "url" text NOT NULL,
  "username" text,
  "encrypted_password" text,
  "scope" text NOT NULL DEFAULT 'global',
  "node_id" uuid REFERENCES "nodes"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "docker_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "description" text,
  "config" jsonb NOT NULL,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "docker_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "node_id" uuid NOT NULL REFERENCES "nodes"("id") ON DELETE CASCADE,
  "container_id" text,
  "container_name" text,
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "progress" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "docker_task_node_idx" ON "docker_tasks"("node_id");
CREATE INDEX IF NOT EXISTS "docker_task_status_idx" ON "docker_tasks"("status");
