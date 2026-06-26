CREATE TABLE "ai_conversation_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_conversation_folders" ADD CONSTRAINT "ai_conversation_folders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversation_folders_user_sort_idx" ON "ai_conversation_folders" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE INDEX "ai_conversation_folders_user_name_idx" ON "ai_conversation_folders" USING btree ("user_id","name");--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_folder_id_ai_conversation_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."ai_conversation_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_conversations_user_folder_idx" ON "ai_conversations" USING btree ("user_id","folder_id");