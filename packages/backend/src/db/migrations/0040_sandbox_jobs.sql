CREATE TABLE "sandbox_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "conversation_id" uuid,
  "kind" varchar(32) NOT NULL,
  "runtime" varchar(32) NOT NULL,
  "resource_tier" varchar(32) NOT NULL,
  "requested_ttl_seconds" integer NOT NULL,
  "effective_ttl_seconds" integer NOT NULL,
  "required_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "container_id" varchar(128),
  "exit_code" integer,
  "output_bytes" integer DEFAULT 0 NOT NULL,
  "stdout_cursor" varchar(128),
  "stderr_cursor" varchar(128),
  "revocation_reason" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sandbox_jobs" ADD CONSTRAINT "sandbox_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sandbox_jobs" ADD CONSTRAINT "sandbox_jobs_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sandbox_jobs_user_status_idx" ON "sandbox_jobs" USING btree ("user_id","status");
--> statement-breakpoint
CREATE INDEX "sandbox_jobs_conversation_idx" ON "sandbox_jobs" USING btree ("conversation_id");
--> statement-breakpoint
CREATE INDEX "sandbox_jobs_status_expires_idx" ON "sandbox_jobs" USING btree ("status","expires_at");
--> statement-breakpoint
CREATE INDEX "sandbox_jobs_container_idx" ON "sandbox_jobs" USING btree ("container_id");
