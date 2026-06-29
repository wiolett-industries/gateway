CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"last_context" jsonb,
	"discovered_toolsets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checkpoint" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" varchar(32) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"ui_message" jsonb NOT NULL,
	"tool_calls" jsonb,
	"tool_call_id" varchar(255),
	"tool_name" varchar(255),
	"tool_args_compact" jsonb,
	"tool_result_raw" jsonb,
	"tool_result_compact" jsonb,
	"tool_result_size_bytes" integer DEFAULT 0 NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_conversation_messages" ADD CONSTRAINT "ai_conversation_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversations_user_title_idx" ON "ai_conversations" USING btree ("user_id","title");
--> statement-breakpoint
CREATE INDEX "ai_conversations_user_updated_idx" ON "ai_conversations" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversation_messages_conversation_sequence_idx" ON "ai_conversation_messages" USING btree ("conversation_id","sequence");
--> statement-breakpoint
CREATE INDEX "ai_conversation_messages_conversation_created_idx" ON "ai_conversation_messages" USING btree ("conversation_id","created_at");
