ALTER TABLE "docker_deployment_slots" ADD COLUMN IF NOT EXISTS "desired_config" jsonb;
