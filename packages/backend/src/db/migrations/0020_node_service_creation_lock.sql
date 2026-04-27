ALTER TABLE "nodes" ADD COLUMN IF NOT EXISTS "service_creation_locked" boolean DEFAULT false NOT NULL;
