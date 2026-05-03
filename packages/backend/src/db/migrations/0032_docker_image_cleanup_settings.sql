CREATE TABLE "docker_image_cleanup_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "node_id" uuid NOT NULL,
  "target_type" text DEFAULT 'container' NOT NULL,
  "container_name" text,
  "deployment_id" uuid,
  "enabled" boolean DEFAULT false NOT NULL,
  "retention_count" integer DEFAULT 2 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "docker_image_cleanup_settings_node_id_nodes_id_fk"
    FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE cascade,
  CONSTRAINT "docker_image_cleanup_settings_deployment_id_docker_deployments_id_fk"
    FOREIGN KEY ("deployment_id") REFERENCES "docker_deployments"("id") ON DELETE cascade
);

INSERT INTO "docker_image_cleanup_settings" (
  "node_id",
  "target_type",
  "container_name",
  "deployment_id",
  "enabled",
  "retention_count",
  "created_at",
  "updated_at"
)
SELECT
  "node_id",
  "target_type",
  "container_name",
  "deployment_id",
  "cleanup_enabled",
  "retention_count",
  "created_at",
  "updated_at"
FROM "docker_webhooks"
WHERE "cleanup_enabled" = true OR "retention_count" <> 2;

CREATE UNIQUE INDEX "docker_image_cleanup_container_unique"
  ON "docker_image_cleanup_settings" ("node_id", "target_type", "container_name");
CREATE UNIQUE INDEX "docker_image_cleanup_deployment_unique"
  ON "docker_image_cleanup_settings" ("deployment_id");

ALTER TABLE "docker_webhooks" DROP COLUMN "cleanup_enabled";
ALTER TABLE "docker_webhooks" DROP COLUMN "retention_count";
