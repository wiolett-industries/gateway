CREATE TABLE "ai_run_credential_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"connector_id" uuid NOT NULL,
	"tool_call_id" varchar(255) NOT NULL,
	"tool_name" varchar(255) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"decision_client_command_id" varchar(128),
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "ai_runs_one_active_per_conversation_idx";--> statement-breakpoint
ALTER TABLE "ai_run_credential_challenges" ADD CONSTRAINT "ai_run_credential_challenges_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run_credential_challenges" ADD CONSTRAINT "ai_run_credential_challenges_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run_credential_challenges" ADD CONSTRAINT "ai_run_credential_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run_credential_challenges" ADD CONSTRAINT "ai_run_credential_challenges_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_run_credential_challenges_run_tool_call_idx" ON "ai_run_credential_challenges" USING btree ("run_id","tool_call_id");--> statement-breakpoint
CREATE INDEX "ai_run_credential_challenges_user_connector_status_idx" ON "ai_run_credential_challenges" USING btree ("user_id","connector_id","status");--> statement-breakpoint
CREATE INDEX "ai_run_credential_challenges_conversation_status_idx" ON "ai_run_credential_challenges" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_one_active_per_conversation_idx" ON "ai_runs" USING btree ("conversation_id") WHERE "ai_runs"."status" IN ('queued', 'running', 'waiting_for_approval', 'waiting_for_answer', 'waiting_for_credential');