ALTER TABLE "docker_registries" ADD COLUMN "source" varchar(32) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "docker_registries" ADD COLUMN "provider" varchar(32);--> statement-breakpoint
ALTER TABLE "docker_registries" ADD COLUMN "read_only" boolean DEFAULT false NOT NULL;