CREATE TABLE IF NOT EXISTS "ai_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "active_message_id" uuid,
  "client_command_id" varchar(128) NOT NULL,
  "assistant_draft_content" text,
  "error" text,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "stopped_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_runs_status_check" CHECK ("status" IN ('queued', 'running', 'waiting_for_approval', 'waiting_for_answer', 'completed', 'failed', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_run_tool_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "assistant_message_id" uuid,
  "tool_call_id" varchar(255) NOT NULL,
  "tool_name" varchar(255) NOT NULL,
  "tool_args" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "classification" varchar(32) NOT NULL,
  "approval_policy" varchar(32) NOT NULL,
  "required_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'created' NOT NULL,
  "decision" varchar(16),
  "decision_user_id" uuid,
  "decision_client_command_id" varchar(128),
  "decision_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "result" jsonb,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_run_tool_calls_classification_check" CHECK ("classification" IN ('system-never-ask', 'read', 'create', 'update', 'delete', 'destructive', 'execute')),
  CONSTRAINT "ai_run_tool_calls_approval_policy_check" CHECK ("approval_policy" IN ('system_skipped', 'auto_approved', 'requires_approval', 'blocked')),
  CONSTRAINT "ai_run_tool_calls_status_check" CHECK ("status" IN ('created', 'pending_approval', 'approved', 'rejected', 'running', 'completed', 'failed', 'stopped')),
  CONSTRAINT "ai_run_tool_calls_decision_check" CHECK ("decision" IS NULL OR "decision" IN ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_run_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "run_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "tool_call_id" varchar(255) NOT NULL,
  "question" text NOT NULL,
  "status" varchar(32) DEFAULT 'pending' NOT NULL,
  "answer" text,
  "answer_user_id" uuid,
  "answer_client_command_id" varchar(128),
  "answered_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_run_questions_status_check" CHECK ("status" IN ('pending', 'answered', 'stopped'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_runs_conversation_id_ai_conversations_id_fk') THEN
    ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_runs_user_id_users_id_fk') THEN
    ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_tool_calls_run_id_ai_runs_id_fk') THEN
    ALTER TABLE "ai_run_tool_calls" ADD CONSTRAINT "ai_run_tool_calls_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_tool_calls_conversation_id_ai_conversations_id_fk') THEN
    ALTER TABLE "ai_run_tool_calls" ADD CONSTRAINT "ai_run_tool_calls_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_tool_calls_assistant_message_id_ai_conversation_messages_id_fk') THEN
    ALTER TABLE "ai_run_tool_calls" ADD CONSTRAINT "ai_run_tool_calls_assistant_message_id_ai_conversation_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."ai_conversation_messages"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_tool_calls_decision_user_id_users_id_fk') THEN
    ALTER TABLE "ai_run_tool_calls" ADD CONSTRAINT "ai_run_tool_calls_decision_user_id_users_id_fk" FOREIGN KEY ("decision_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_questions_run_id_ai_runs_id_fk') THEN
    ALTER TABLE "ai_run_questions" ADD CONSTRAINT "ai_run_questions_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_questions_conversation_id_ai_conversations_id_fk') THEN
    ALTER TABLE "ai_run_questions" ADD CONSTRAINT "ai_run_questions_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_run_questions_answer_user_id_users_id_fk') THEN
    ALTER TABLE "ai_run_questions" ADD CONSTRAINT "ai_run_questions_answer_user_id_users_id_fk" FOREIGN KEY ("answer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_runs_one_active_per_conversation_idx" ON "ai_runs" USING btree ("conversation_id") WHERE "status" IN ('queued', 'running', 'waiting_for_approval', 'waiting_for_answer');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_runs_user_conversation_command_idx" ON "ai_runs" USING btree ("user_id", "conversation_id", "client_command_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_runs_conversation_status_idx" ON "ai_runs" USING btree ("conversation_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_runs_user_created_idx" ON "ai_runs" USING btree ("user_id", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_run_tool_calls_run_tool_call_idx" ON "ai_run_tool_calls" USING btree ("run_id", "tool_call_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_run_tool_calls_decision_command_idx" ON "ai_run_tool_calls" USING btree ("run_id", "decision_client_command_id") WHERE "decision_client_command_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_run_tool_calls_run_status_idx" ON "ai_run_tool_calls" USING btree ("run_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_run_tool_calls_conversation_status_idx" ON "ai_run_tool_calls" USING btree ("conversation_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_run_questions_answer_command_idx" ON "ai_run_questions" USING btree ("run_id", "answer_client_command_id") WHERE "answer_client_command_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_run_questions_run_status_idx" ON "ai_run_questions" USING btree ("run_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_run_questions_conversation_status_idx" ON "ai_run_questions" USING btree ("conversation_id", "status");
