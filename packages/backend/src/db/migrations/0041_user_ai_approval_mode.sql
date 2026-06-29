ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "ai_approval_mode" varchar(32) NOT NULL DEFAULT 'normal';
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_ai_approval_mode_check'
  ) THEN
    ALTER TABLE "users"
    ADD CONSTRAINT "users_ai_approval_mode_check"
    CHECK ("ai_approval_mode" IN ('always-ask', 'normal', 'bypass-non-destructive', 'bypass-everything'));
  END IF;
END $$;
