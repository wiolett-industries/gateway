CREATE TYPE "public"."proxy_upstream_kind" AS ENUM('manual', 'docker_container', 'docker_deployment');--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "service_address" varchar(255);--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "upstream_kind" "proxy_upstream_kind" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "docker_node_id" uuid;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "docker_container_name" varchar(255);--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "docker_deployment_id" uuid;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "docker_container_port" integer;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "docker_host_port" integer;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD COLUMN "docker_protocol" varchar(8);--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_docker_node_id_nodes_id_fk" FOREIGN KEY ("docker_node_id") REFERENCES "public"."nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proxy_hosts" ADD CONSTRAINT "proxy_hosts_docker_deployment_id_docker_deployments_id_fk" FOREIGN KEY ("docker_deployment_id") REFERENCES "public"."docker_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proxy_host_docker_node_idx" ON "proxy_hosts" USING btree ("docker_node_id");--> statement-breakpoint
CREATE INDEX "proxy_host_docker_deployment_idx" ON "proxy_hosts" USING btree ("docker_deployment_id");