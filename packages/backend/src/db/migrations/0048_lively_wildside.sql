ALTER TABLE "nodes" ADD COLUMN "enrollment_token_selector" varchar(32);--> statement-breakpoint
CREATE INDEX "node_enrollment_token_selector_idx" ON "nodes" USING btree ("enrollment_token_selector");