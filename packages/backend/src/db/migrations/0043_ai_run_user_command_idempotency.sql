CREATE UNIQUE INDEX IF NOT EXISTS "ai_runs_user_command_idx" ON "ai_runs" USING btree ("user_id", "client_command_id");
