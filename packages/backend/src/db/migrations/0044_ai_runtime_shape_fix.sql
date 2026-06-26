ALTER TABLE "ai_runs" ADD COLUMN IF NOT EXISTS "assistant_draft_content" text;
--> statement-breakpoint
ALTER TABLE "ai_run_tool_calls" ADD COLUMN IF NOT EXISTS "result" jsonb;
--> statement-breakpoint
ALTER TABLE "ai_run_questions" ADD COLUMN IF NOT EXISTS "tool_call_id" varchar(255);
--> statement-breakpoint
UPDATE "ai_run_questions"
SET "tool_call_id" = "id"::text
WHERE "tool_call_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "ai_run_questions" ALTER COLUMN "tool_call_id" SET NOT NULL;
