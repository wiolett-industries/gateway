-- Replace permission enum column with granular scopes jsonb column
ALTER TABLE "api_tokens" DROP COLUMN IF EXISTS "permission";
DROP TYPE IF EXISTS "public"."api_token_permission";
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "scopes" jsonb NOT NULL DEFAULT '[]';
