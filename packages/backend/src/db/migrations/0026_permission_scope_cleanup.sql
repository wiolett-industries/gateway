UPDATE "api_tokens"
SET "scopes" = COALESCE(
  (
    SELECT jsonb_agg(scope)
    FROM jsonb_array_elements_text("api_tokens"."scopes") AS scope
    WHERE scope NOT IN ('admin:housekeeping', 'admin:system')
  ),
  '[]'::jsonb
)
WHERE "scopes" ?| ARRAY['admin:housekeeping', 'admin:system'];

UPDATE "permission_groups"
SET "scopes" = COALESCE(
  (
    SELECT jsonb_agg(scope)
    FROM jsonb_array_elements_text("permission_groups"."scopes") AS scope
    WHERE scope NOT IN ('admin:housekeeping', 'admin:system')
  ),
  '[]'::jsonb
)
WHERE "name" <> 'system-admin'
  AND "scopes" ?| ARRAY['admin:housekeeping', 'admin:system'];
