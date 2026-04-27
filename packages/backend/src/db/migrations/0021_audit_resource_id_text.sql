ALTER TABLE "audit_log" ALTER COLUMN "resource_id" TYPE text USING "resource_id"::text;
--> statement-breakpoint

UPDATE "audit_log"
SET "action" = 'docker.container.create', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.start', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/start$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.stop', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/stop$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.restart', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/restart$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.kill', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/kill$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.remove', "resource_type" = 'docker-container'
WHERE "action" IN ('route.delete', 'http.delete')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.rename', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/rename$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.duplicate', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/duplicate$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.update', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/update$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.live_update', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/live-update$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.recreate', "resource_type" = 'docker-container'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/recreate$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.container.env.update', "resource_type" = 'docker-container'
WHERE "action" IN ('route.put', 'http.put')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/env$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.file.write', "resource_type" = 'docker-container'
WHERE "action" IN ('route.put', 'http.put')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/containers/[^/]+/files/write$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.image.pull', "resource_type" = 'docker-image'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/images/pull(-sync)?$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.image.remove', "resource_type" = 'docker-image'
WHERE "action" IN ('route.delete', 'http.delete')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/images/[^/]+$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.image.prune', "resource_type" = 'docker-image'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/images/prune$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.volume.create', "resource_type" = 'docker-volume'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/volumes$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.volume.remove', "resource_type" = 'docker-volume'
WHERE "action" IN ('route.delete', 'http.delete')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/volumes/[^/]+$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.network.create', "resource_type" = 'docker-network'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/networks$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.network.remove', "resource_type" = 'docker-network'
WHERE "action" IN ('route.delete', 'http.delete')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/networks/[^/]+$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.network.connect', "resource_type" = 'docker-network'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/networks/[^/]+/connect$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.network.disconnect', "resource_type" = 'docker-network'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/networks/[^/]+/disconnect$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.create', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.update', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.put', 'http.put')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.delete', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.delete', 'http.delete')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.start', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+/start$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.stop', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+/stop$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.restart', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+/restart$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.kill', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+/kill$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.deploy', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+/deploy$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.switch', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+/switch$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.rollback', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+/rollback$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.deployment.slot.stop', "resource_type" = 'docker-deployment'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/deployments/[^/]+/slots/[^/]+/stop$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.health_check.configure', "resource_type" = 'docker-health-check'
WHERE "action" IN ('route.put', 'http.put')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/(containers|deployments)/[^/]+/health-check$';
--> statement-breakpoint
UPDATE "audit_log"
SET "action" = 'docker.health_check.test', "resource_type" = 'docker-health-check'
WHERE "action" IN ('route.post', 'http.post')
  AND "details"->>'path' ~ '^/api/docker/nodes/[^/]+/(containers|deployments)/[^/]+/health-check/test$';
