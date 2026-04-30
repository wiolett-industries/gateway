WITH denied(scope) AS (
  VALUES
    ('feat:ai:use'),
    ('feat:ai:configure'),
    ('mcp:use'),
    ('admin:system'),
    ('admin:users'),
    ('admin:groups'),
    ('settings:gateway:view'),
    ('settings:gateway:edit'),
    ('proxy:raw:read'),
    ('proxy:raw:write'),
    ('proxy:raw:toggle'),
    ('proxy:advanced:bypass'),
    ('nodes:config:view'),
    ('nodes:config:edit')
)
UPDATE "api_tokens"
SET "scopes" = COALESCE(
  (
    SELECT jsonb_agg(scope)
    FROM jsonb_array_elements_text("api_tokens"."scopes") AS scope
	    WHERE NOT EXISTS (SELECT 1 FROM denied WHERE scope = denied.scope OR scope LIKE denied.scope || ':%')
  ),
  '[]'::jsonb
);

WITH denied(scope) AS (
  VALUES
    ('feat:ai:use'),
    ('feat:ai:configure'),
    ('mcp:use'),
    ('admin:system'),
    ('admin:users'),
    ('admin:groups'),
    ('settings:gateway:view'),
    ('settings:gateway:edit'),
    ('proxy:raw:read'),
    ('proxy:raw:write'),
    ('proxy:raw:toggle'),
    ('proxy:advanced:bypass'),
    ('nodes:config:view'),
    ('nodes:config:edit')
)
UPDATE "oauth_authorization_codes"
SET
  "requested_scopes" = COALESCE(
    (
      SELECT jsonb_agg(scope)
      FROM jsonb_array_elements_text("oauth_authorization_codes"."requested_scopes") AS scope
      WHERE NOT EXISTS (SELECT 1 FROM denied WHERE scope = denied.scope OR scope LIKE denied.scope || ':%')
    ),
    '[]'::jsonb
  ),
  "scopes" = COALESCE(
    (
      SELECT jsonb_agg(scope)
      FROM jsonb_array_elements_text("oauth_authorization_codes"."scopes") AS scope
      WHERE NOT EXISTS (SELECT 1 FROM denied WHERE scope = denied.scope OR scope LIKE denied.scope || ':%')
    ),
    '[]'::jsonb
  );

WITH denied(scope) AS (
  VALUES
    ('feat:ai:use'),
    ('feat:ai:configure'),
    ('mcp:use'),
    ('admin:system'),
    ('admin:users'),
    ('admin:groups'),
    ('settings:gateway:view'),
    ('settings:gateway:edit'),
    ('proxy:raw:read'),
    ('proxy:raw:write'),
    ('proxy:raw:toggle'),
    ('proxy:advanced:bypass'),
    ('nodes:config:view'),
    ('nodes:config:edit')
)
UPDATE "oauth_refresh_tokens"
SET "scopes" = COALESCE(
  (
    SELECT jsonb_agg(scope)
    FROM jsonb_array_elements_text("oauth_refresh_tokens"."scopes") AS scope
	    WHERE NOT EXISTS (SELECT 1 FROM denied WHERE scope = denied.scope OR scope LIKE denied.scope || ':%')
  ),
  '[]'::jsonb
);

WITH denied(scope) AS (
  VALUES
    ('feat:ai:use'),
    ('feat:ai:configure'),
    ('mcp:use'),
    ('admin:system'),
    ('admin:users'),
    ('admin:groups'),
    ('settings:gateway:view'),
    ('settings:gateway:edit'),
    ('proxy:raw:read'),
    ('proxy:raw:write'),
    ('proxy:raw:toggle'),
    ('proxy:advanced:bypass'),
    ('nodes:config:view'),
    ('nodes:config:edit')
)
UPDATE "oauth_access_tokens"
SET "scopes" = COALESCE(
  (
    SELECT jsonb_agg(scope)
    FROM jsonb_array_elements_text("oauth_access_tokens"."scopes") AS scope
	    WHERE NOT EXISTS (SELECT 1 FROM denied WHERE scope = denied.scope OR scope LIKE denied.scope || ':%')
  ),
  '[]'::jsonb
);

CREATE OR REPLACE FUNCTION gateway_canonicalize_scopes(scopes jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
	  WITH all_scope(scope) AS (
	    VALUES
	      ('pki:ca:list:root'),
	      ('pki:ca:list:intermediate'),
	      ('pki:ca:view:root'),
	      ('pki:ca:view:intermediate'),
	      ('pki:ca:create:root'),
	      ('pki:ca:create:intermediate'),
	      ('pki:ca:revoke:root'),
	      ('pki:ca:revoke:intermediate'),
	      ('pki:cert:list'),
	      ('pki:cert:view'),
	      ('pki:cert:issue'),
	      ('pki:cert:revoke'),
	      ('pki:cert:export'),
	      ('pki:templates:list'),
	      ('pki:templates:view'),
	      ('pki:templates:create'),
	      ('pki:templates:edit'),
	      ('pki:templates:delete'),
	      ('proxy:list'),
	      ('proxy:view'),
	      ('proxy:create'),
	      ('proxy:edit'),
	      ('proxy:delete'),
	      ('proxy:raw:read'),
	      ('proxy:raw:write'),
	      ('proxy:raw:toggle'),
	      ('proxy:advanced'),
	      ('proxy:advanced:bypass'),
	      ('ssl:cert:list'),
	      ('ssl:cert:view'),
	      ('ssl:cert:issue'),
	      ('ssl:cert:delete'),
	      ('ssl:cert:revoke'),
	      ('ssl:cert:export'),
	      ('acl:list'),
	      ('acl:view'),
	      ('acl:create'),
	      ('acl:edit'),
	      ('acl:delete'),
	      ('nodes:list'),
	      ('nodes:details'),
	      ('nodes:create'),
	      ('nodes:rename'),
	      ('nodes:delete'),
	      ('nodes:config:view'),
	      ('nodes:config:edit'),
	      ('nodes:logs'),
	      ('nodes:console'),
	      ('nodes:lock'),
	      ('admin:users'),
	      ('admin:groups'),
	      ('admin:audit'),
	      ('admin:system'),
	      ('admin:details:certificates'),
	      ('admin:update'),
	      ('admin:alerts'),
	      ('settings:gateway:view'),
	      ('settings:gateway:edit'),
	      ('housekeeping:view'),
	      ('housekeeping:run'),
	      ('housekeeping:configure'),
	      ('license:view'),
	      ('license:manage'),
	      ('feat:ai:use'),
	      ('feat:ai:configure'),
	      ('mcp:use'),
	      ('docker:containers:list'),
	      ('docker:containers:view'),
	      ('docker:containers:create'),
	      ('docker:containers:edit'),
	      ('docker:containers:manage'),
	      ('docker:containers:environment'),
	      ('docker:containers:delete'),
	      ('docker:containers:console'),
	      ('docker:containers:files'),
	      ('docker:containers:secrets'),
	      ('docker:containers:webhooks'),
	      ('docker:images:list'),
	      ('docker:images:pull'),
	      ('docker:images:delete'),
	      ('docker:volumes:list'),
	      ('docker:volumes:create'),
	      ('docker:volumes:delete'),
	      ('docker:networks:list'),
	      ('docker:networks:create'),
	      ('docker:networks:edit'),
	      ('docker:networks:delete'),
	      ('docker:registries:list'),
	      ('docker:registries:create'),
	      ('docker:registries:edit'),
	      ('docker:registries:delete'),
	      ('docker:tasks'),
	      ('databases:list'),
	      ('databases:view'),
	      ('databases:create'),
	      ('databases:edit'),
	      ('databases:delete'),
	      ('databases:query:read'),
	      ('databases:query:write'),
	      ('databases:query:admin'),
	      ('databases:credentials:reveal'),
	      ('notifications:alerts:list'),
	      ('notifications:alerts:view'),
	      ('notifications:alerts:create'),
	      ('notifications:alerts:edit'),
	      ('notifications:alerts:delete'),
	      ('notifications:webhooks:list'),
	      ('notifications:webhooks:view'),
	      ('notifications:webhooks:create'),
	      ('notifications:webhooks:edit'),
	      ('notifications:webhooks:delete'),
	      ('notifications:deliveries:list'),
	      ('notifications:deliveries:view'),
	      ('notifications:view'),
	      ('notifications:manage'),
	      ('logs:environments:list'),
	      ('logs:environments:view'),
	      ('logs:environments:create'),
	      ('logs:environments:edit'),
	      ('logs:environments:delete'),
	      ('logs:tokens:list'),
	      ('logs:tokens:create'),
	      ('logs:tokens:delete'),
	      ('logs:schemas:list'),
	      ('logs:schemas:view'),
	      ('logs:schemas:create'),
	      ('logs:schemas:edit'),
	      ('logs:schemas:delete'),
	      ('logs:read'),
	      ('logs:manage'),
	      ('status-page:view'),
	      ('status-page:manage'),
	      ('status-page:incidents:create'),
	      ('status-page:incidents:update'),
	      ('status-page:incidents:resolve'),
	      ('status-page:incidents:delete')
	  ),
	  resource_scopable(scope) AS (
    VALUES
      ('pki:ca:create:intermediate'),
      ('pki:cert:issue'),
      ('pki:cert:revoke'),
      ('pki:cert:export'),
      ('proxy:view'),
      ('proxy:create'),
      ('proxy:edit'),
      ('proxy:delete'),
      ('proxy:advanced'),
      ('proxy:advanced:bypass'),
      ('proxy:raw:read'),
      ('proxy:raw:write'),
      ('proxy:raw:toggle'),
      ('ssl:cert:view'),
      ('ssl:cert:delete'),
      ('ssl:cert:revoke'),
      ('ssl:cert:export'),
      ('acl:view'),
      ('acl:edit'),
      ('acl:delete'),
      ('nodes:details'),
      ('nodes:config:view'),
      ('nodes:config:edit'),
      ('nodes:logs'),
      ('nodes:console'),
      ('nodes:rename'),
      ('nodes:delete'),
      ('nodes:lock'),
      ('docker:containers:list'),
      ('docker:containers:view'),
      ('docker:containers:create'),
      ('docker:containers:edit'),
      ('docker:containers:manage'),
      ('docker:containers:environment'),
      ('docker:containers:delete'),
      ('docker:containers:console'),
      ('docker:containers:files'),
      ('docker:containers:secrets'),
      ('docker:containers:webhooks'),
      ('docker:images:list'),
      ('docker:images:pull'),
      ('docker:images:delete'),
      ('docker:volumes:list'),
      ('docker:volumes:create'),
      ('docker:volumes:delete'),
      ('docker:networks:list'),
      ('docker:networks:create'),
      ('docker:networks:edit'),
      ('docker:networks:delete'),
      ('databases:list'),
      ('databases:view'),
      ('databases:edit'),
      ('databases:delete'),
      ('databases:query:read'),
      ('databases:query:write'),
      ('databases:query:admin'),
      ('databases:credentials:reveal'),
      ('logs:environments:view'),
      ('logs:environments:edit'),
      ('logs:environments:delete'),
      ('logs:tokens:list'),
      ('logs:tokens:create'),
      ('logs:tokens:delete'),
      ('logs:schemas:view'),
      ('logs:schemas:edit'),
      ('logs:schemas:delete'),
      ('logs:read')
  ),
  raw(scope) AS (
    SELECT DISTINCT value
    FROM jsonb_array_elements_text(COALESCE(scopes, '[]'::jsonb)) AS value
  ),
  parsed AS (
    SELECT
      raw.scope,
	      COALESCE(
	        (
	          SELECT all_scope.scope
	          FROM all_scope
	          WHERE raw.scope = all_scope.scope
	          LIMIT 1
	        ),
	        (
	          SELECT resource_scopable.scope
	          FROM resource_scopable
	          WHERE raw.scope LIKE resource_scopable.scope || ':%'
	          ORDER BY length(resource_scopable.scope) DESC
	          LIMIT 1
	        )
	      ) AS base_scope
    FROM raw
  ),
  canonical(scope) AS (
	    SELECT parsed.scope
	    FROM parsed
	    WHERE parsed.base_scope IS NOT NULL
	      AND (parsed.scope = parsed.base_scope
	      OR NOT EXISTS (SELECT 1 FROM parsed broad WHERE broad.scope = parsed.base_scope)
	      )
  )
  SELECT COALESCE(jsonb_agg(scope ORDER BY scope), '[]'::jsonb)
  FROM canonical;
$$;

UPDATE "permission_groups"
SET "scopes" = gateway_canonicalize_scopes("scopes")
WHERE "is_builtin" = false;

UPDATE "api_tokens"
SET "scopes" = gateway_canonicalize_scopes("scopes");

UPDATE "oauth_authorization_codes"
SET
  "requested_scopes" = gateway_canonicalize_scopes("requested_scopes"),
  "scopes" = gateway_canonicalize_scopes("scopes");

UPDATE "oauth_refresh_tokens"
SET "scopes" = gateway_canonicalize_scopes("scopes");

UPDATE "oauth_access_tokens"
SET "scopes" = gateway_canonicalize_scopes("scopes");

DROP FUNCTION gateway_canonicalize_scopes(jsonb);
