CREATE TYPE "public"."health_check_body_match_mode" AS ENUM('includes', 'exact', 'starts_with', 'ends_with');--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "health_check_body_match_mode" "health_check_body_match_mode" DEFAULT 'includes' NOT NULL;
