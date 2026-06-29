CREATE TABLE "ai_conversation_search_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"kind" varchar(32) NOT NULL,
	"role" varchar(32),
	"text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"tokens" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversation_search_documents" ADD CONSTRAINT "ai_conversation_search_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_search_documents" ADD CONSTRAINT "ai_conversation_search_documents_project_id_ai_conversation_folders_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai_conversation_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_search_documents" ADD CONSTRAINT "ai_conversation_search_documents_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversation_search_documents" ADD CONSTRAINT "ai_conversation_search_documents_message_id_ai_conversation_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ai_conversation_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversation_search_user_project_idx" ON "ai_conversation_search_documents" USING btree ("user_id","project_id");--> statement-breakpoint
CREATE INDEX "ai_conversation_search_conversation_idx" ON "ai_conversation_search_documents" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_conversation_search_message_idx" ON "ai_conversation_search_documents" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "ai_conversation_search_created_idx" ON "ai_conversation_search_documents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_conversation_search_normalized_idx" ON "ai_conversation_search_documents" USING btree ("normalized_text");