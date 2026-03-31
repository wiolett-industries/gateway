-- Create permission_groups table
CREATE TABLE IF NOT EXISTS "permission_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "description" text,
  "is_builtin" boolean NOT NULL DEFAULT false,
  "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permission_groups_name_idx" ON "permission_groups" USING btree ("name");
--> statement-breakpoint

-- Insert built-in groups using a CTE to capture their IDs
DO $$
DECLARE
  v_sysadmin_id uuid;
  v_admin_id uuid;
  v_operator_id uuid;
  v_viewer_id uuid;
BEGIN
  -- System-admin group: all scopes including admin:system (protected)
  INSERT INTO "permission_groups" ("name", "description", "is_builtin", "scopes")
  VALUES (
    'system-admin',
    'System administrator — full access, protected from non-system-admins',
    true,
    '["ca:read","ca:create:root","ca:create:intermediate","ca:revoke","cert:read","cert:issue","cert:revoke","cert:export","template:read","template:manage","proxy:read","proxy:manage","proxy:delete","ssl:read","ssl:manage","ssl:delete","access-list:read","access-list:manage","access-list:delete","admin:users","admin:groups","admin:audit","admin:system","admin:update","admin:housekeeping","admin:alerts","admin:ai-config","ai:use","proxy:advanced"]'::jsonb
  )
  RETURNING "id" INTO v_sysadmin_id;

  -- Admin group: all scopes EXCEPT admin:system
  INSERT INTO "permission_groups" ("name", "description", "is_builtin", "scopes")
  VALUES (
    'admin',
    'Full access to all features except system protection',
    true,
    '["ca:read","ca:create:root","ca:create:intermediate","ca:revoke","cert:read","cert:issue","cert:revoke","cert:export","template:read","template:manage","proxy:read","proxy:manage","proxy:delete","ssl:read","ssl:manage","ssl:delete","access-list:read","access-list:manage","access-list:delete","admin:users","admin:groups","admin:audit","admin:update","admin:housekeeping","admin:alerts","admin:ai-config","ai:use","proxy:advanced"]'::jsonb
  )
  RETURNING "id" INTO v_admin_id;

  -- Operator group: operational + management scopes
  INSERT INTO "permission_groups" ("name", "description", "is_builtin", "scopes")
  VALUES (
    'operator',
    'Operational access — manage certificates, proxies, and SSL',
    true,
    '["ca:read","cert:read","cert:issue","cert:revoke","cert:export","template:read","template:manage","proxy:read","proxy:manage","ssl:read","ssl:manage","access-list:read","access-list:manage","ai:use","admin:alerts"]'::jsonb
  )
  RETURNING "id" INTO v_operator_id;

  -- Viewer group: read-only scopes
  INSERT INTO "permission_groups" ("name", "description", "is_builtin", "scopes")
  VALUES (
    'viewer',
    'Read-only access to all resources',
    true,
    '["ca:read","cert:read","template:read","proxy:read","ssl:read","access-list:read"]'::jsonb
  )
  RETURNING "id" INTO v_viewer_id;

  -- Add group_id column to users (nullable initially)
  ALTER TABLE "users" ADD COLUMN "group_id" uuid;

  -- Add is_blocked column
  ALTER TABLE "users" ADD COLUMN "is_blocked" boolean NOT NULL DEFAULT false;

  -- Migrate existing roles to groups (admin → system-admin for full protection)
  UPDATE "users" SET "group_id" = v_sysadmin_id WHERE "role" = 'admin';
  UPDATE "users" SET "group_id" = v_operator_id WHERE "role" = 'operator';
  UPDATE "users" SET "group_id" = v_viewer_id WHERE "role" = 'viewer';
  UPDATE "users" SET "group_id" = v_viewer_id, "is_blocked" = true WHERE "role" = 'blocked';

  -- Make group_id NOT NULL now that all rows are populated
  ALTER TABLE "users" ALTER COLUMN "group_id" SET NOT NULL;

  -- Add FK constraint
  ALTER TABLE "users" ADD CONSTRAINT "users_group_id_permission_groups_id_fk"
    FOREIGN KEY ("group_id") REFERENCES "permission_groups"("id") ON DELETE RESTRICT;

  -- Add index on group_id
  CREATE INDEX IF NOT EXISTS "users_group_id_idx" ON "users" USING btree ("group_id");

  -- Drop the role column
  ALTER TABLE "users" DROP COLUMN "role";

  -- Drop the old enum type
  DROP TYPE IF EXISTS "public"."user_role";
END $$;
