CREATE TABLE "integration_connector_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connector_id" uuid NOT NULL,
	"credential_type" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"secret_last4" varchar(16),
	"username" text,
	"project_remote_id" varchar(128),
	"project_full_path" text,
	"registry_url" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_connector_credentials" ADD CONSTRAINT "integration_connector_credentials_connector_id_integration_connectors_id_fk" FOREIGN KEY ("connector_id") REFERENCES "public"."integration_connectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_credential_connector_idx" ON "integration_connector_credentials" USING btree ("connector_id");--> statement-breakpoint
CREATE INDEX "integration_credential_project_idx" ON "integration_connector_credentials" USING btree ("connector_id","project_remote_id");