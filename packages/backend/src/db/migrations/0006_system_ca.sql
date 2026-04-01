-- Add isSystem flag to certificate_authorities for locked system CAs (e.g. node mTLS)
ALTER TABLE "certificate_authorities" ADD COLUMN IF NOT EXISTS "is_system" boolean DEFAULT false NOT NULL;
