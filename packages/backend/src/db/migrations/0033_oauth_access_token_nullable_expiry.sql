ALTER TABLE "oauth_access_tokens"
  ALTER COLUMN "expires_at" DROP NOT NULL;

UPDATE "oauth_access_tokens"
SET "expires_at" = NULL
WHERE "resource" LIKE '%/api/mcp';
