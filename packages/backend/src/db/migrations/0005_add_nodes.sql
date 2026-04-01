-- Add nodes table and node_id to proxy_hosts

DO $$ BEGIN
  CREATE TYPE "public"."node_type" AS ENUM('nginx', 'bastion');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."node_status" AS ENUM('pending', 'online', 'offline', 'error');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "nodes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "type" "node_type" DEFAULT 'nginx' NOT NULL,
  "hostname" varchar(255) NOT NULL,
  "display_name" varchar(255),
  "status" "node_status" DEFAULT 'pending' NOT NULL,
  "enrollment_token_hash" varchar(255),
  "certificate_serial" varchar(255),
  "certificate_expires_at" timestamp with time zone,
  "daemon_version" varchar(50),
  "os_info" varchar(255),
  "config_version_hash" varchar(64),
  "capabilities" jsonb DEFAULT '{}'::jsonb,
  "last_seen_at" timestamp with time zone,
  "last_health_report" jsonb,
  "last_stats_report" jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "is_default" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "node_type_idx" ON "nodes" USING btree ("type");
CREATE INDEX IF NOT EXISTS "node_status_idx" ON "nodes" USING btree ("status");
CREATE INDEX IF NOT EXISTS "node_hostname_idx" ON "nodes" USING btree ("hostname");

-- Add node_id to proxy_hosts
ALTER TABLE "proxy_hosts" ADD COLUMN IF NOT EXISTS "node_id" uuid;

DO $$ BEGIN
  ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_node_id_nodes_id_fk"
    FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "proxy_host_node_idx" ON "proxy_hosts" USING btree ("node_id");
