ALTER TABLE "ai_runs" DROP CONSTRAINT IF EXISTS "ai_runs_status_check";--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_status_check" CHECK ("status" IN ('queued', 'running', 'waiting_for_approval', 'waiting_for_answer', 'waiting_for_credential', 'completed', 'failed', 'stopped'));--> statement-breakpoint
DROP INDEX IF EXISTS "ai_runs_one_active_per_conversation_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_one_active_per_conversation_idx" ON "ai_runs" USING btree ("conversation_id") WHERE "ai_runs"."status" IN ('queued', 'running', 'waiting_for_approval', 'waiting_for_answer', 'waiting_for_credential');
