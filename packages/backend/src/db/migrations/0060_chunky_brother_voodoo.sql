CREATE TABLE "gitlab_user_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"encrypted_token" text NOT NULL,
	"token_last4" varchar(16) NOT NULL,
	"gitlab_user_id" varchar(64) NOT NULL,
	"gitlab_username" varchar(255) NOT NULL,
	"token_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"token_expires_at" timestamp with time zone,
	"status" varchar(16) DEFAULT 'valid' NOT NULL,
	"last_validated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gitlab_user_credentials_user_connector_unique" UNIQUE("user_id","connector_id")
);
--> statement-breakpoint
ALTER TABLE "gitlab_user_credentials" ADD CONSTRAINT "gitlab_user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gitlab_user_credentials" ADD CONSTRAINT "gitlab_user_credentials_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gitlab_user_credentials_user_idx" ON "gitlab_user_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gitlab_user_credentials_connector_idx" ON "gitlab_user_credentials" USING btree ("connector_id");