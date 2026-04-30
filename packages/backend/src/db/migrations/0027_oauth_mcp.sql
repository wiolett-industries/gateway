CREATE TABLE "oauth_clients" (
  "client_id" varchar(80) PRIMARY KEY NOT NULL,
  "client_name" varchar(255) NOT NULL,
  "client_uri" text,
  "logo_uri" text,
  "redirect_uris" jsonb NOT NULL,
  "raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "oauth_authorization_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code_hash" text NOT NULL,
  "client_id" varchar(80) NOT NULL,
  "user_id" uuid NOT NULL,
  "redirect_uri" text NOT NULL,
  "code_challenge" varchar(128) NOT NULL,
  "requested_scopes" jsonb NOT NULL,
  "scopes" jsonb NOT NULL,
  "resource" text,
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "oauth_refresh_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" varchar(20) NOT NULL,
  "client_id" varchar(80) NOT NULL,
  "user_id" uuid NOT NULL,
  "scopes" jsonb NOT NULL,
  "resource" text,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "replaced_by_token_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "oauth_access_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "token_hash" text NOT NULL,
  "token_prefix" varchar(20) NOT NULL,
  "client_id" varchar(80) NOT NULL,
  "user_id" uuid NOT NULL,
  "refresh_token_id" uuid,
  "scopes" jsonb NOT NULL,
  "resource" text,
  "expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "oauth_authorization_codes"
  ADD CONSTRAINT "oauth_authorization_codes_client_id_oauth_clients_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "oauth_authorization_codes"
  ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "oauth_refresh_tokens"
  ADD CONSTRAINT "oauth_refresh_tokens_client_id_oauth_clients_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "oauth_refresh_tokens"
  ADD CONSTRAINT "oauth_refresh_tokens_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "oauth_access_tokens"
  ADD CONSTRAINT "oauth_access_tokens_client_id_oauth_clients_client_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "oauth_access_tokens"
  ADD CONSTRAINT "oauth_access_tokens_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "oauth_access_tokens"
  ADD CONSTRAINT "oauth_access_tokens_refresh_token_id_oauth_refresh_tokens_id_fk"
  FOREIGN KEY ("refresh_token_id") REFERENCES "public"."oauth_refresh_tokens"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "oauth_clients_name_idx" ON "oauth_clients" USING btree ("client_name");
CREATE INDEX "oauth_authorization_codes_code_hash_idx" ON "oauth_authorization_codes" USING btree ("code_hash");
CREATE INDEX "oauth_authorization_codes_client_idx" ON "oauth_authorization_codes" USING btree ("client_id");
CREATE INDEX "oauth_authorization_codes_user_idx" ON "oauth_authorization_codes" USING btree ("user_id");
CREATE INDEX "oauth_refresh_tokens_token_hash_idx" ON "oauth_refresh_tokens" USING btree ("token_hash");
CREATE INDEX "oauth_refresh_tokens_client_idx" ON "oauth_refresh_tokens" USING btree ("client_id");
CREATE INDEX "oauth_refresh_tokens_user_idx" ON "oauth_refresh_tokens" USING btree ("user_id");
CREATE INDEX "oauth_access_tokens_token_hash_idx" ON "oauth_access_tokens" USING btree ("token_hash");
CREATE INDEX "oauth_access_tokens_client_idx" ON "oauth_access_tokens" USING btree ("client_id");
CREATE INDEX "oauth_access_tokens_user_idx" ON "oauth_access_tokens" USING btree ("user_id");
