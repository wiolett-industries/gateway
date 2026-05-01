WITH obsolete(scope) AS (
  VALUES
    ('pki:ca:list:root'),
    ('pki:ca:list:intermediate'),
    ('pki:cert:list'),
    ('pki:templates:list'),
    ('proxy:list'),
    ('ssl:cert:list'),
    ('acl:list'),
    ('nodes:list'),
    ('docker:containers:list'),
    ('docker:images:list'),
    ('docker:volumes:list'),
    ('docker:networks:list'),
    ('docker:registries:list'),
    ('databases:list'),
    ('notifications:alerts:list'),
    ('notifications:webhooks:list'),
    ('notifications:deliveries:list'),
    ('logs:environments:list'),
    ('logs:tokens:list'),
    ('logs:schemas:list')
)
UPDATE "permission_groups"
SET "scopes" = COALESCE(
  (
    SELECT jsonb_agg(scope_value)
    FROM jsonb_array_elements_text("permission_groups"."scopes") AS elems(scope_value)
    WHERE NOT EXISTS (
      SELECT 1 FROM obsolete WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
    )
  ),
  '[]'::jsonb
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text("permission_groups"."scopes") AS elems(scope_value), obsolete
  WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
);

WITH obsolete(scope) AS (
  VALUES
    ('pki:ca:list:root'),
    ('pki:ca:list:intermediate'),
    ('pki:cert:list'),
    ('pki:templates:list'),
    ('proxy:list'),
    ('ssl:cert:list'),
    ('acl:list'),
    ('nodes:list'),
    ('docker:containers:list'),
    ('docker:images:list'),
    ('docker:volumes:list'),
    ('docker:networks:list'),
    ('docker:registries:list'),
    ('databases:list'),
    ('notifications:alerts:list'),
    ('notifications:webhooks:list'),
    ('notifications:deliveries:list'),
    ('logs:environments:list'),
    ('logs:tokens:list'),
    ('logs:schemas:list')
)
UPDATE "api_tokens"
SET "scopes" = COALESCE(
  (
    SELECT jsonb_agg(scope_value)
    FROM jsonb_array_elements_text("api_tokens"."scopes") AS elems(scope_value)
    WHERE NOT EXISTS (
      SELECT 1 FROM obsolete WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
    )
  ),
  '[]'::jsonb
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text("api_tokens"."scopes") AS elems(scope_value), obsolete
  WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
);

WITH obsolete(scope) AS (
  VALUES
    ('pki:ca:list:root'),
    ('pki:ca:list:intermediate'),
    ('pki:cert:list'),
    ('pki:templates:list'),
    ('proxy:list'),
    ('ssl:cert:list'),
    ('acl:list'),
    ('nodes:list'),
    ('docker:containers:list'),
    ('docker:images:list'),
    ('docker:volumes:list'),
    ('docker:networks:list'),
    ('docker:registries:list'),
    ('databases:list'),
    ('notifications:alerts:list'),
    ('notifications:webhooks:list'),
    ('notifications:deliveries:list'),
    ('logs:environments:list'),
    ('logs:tokens:list'),
    ('logs:schemas:list')
)
UPDATE "oauth_authorization_codes"
SET
  "requested_scopes" = COALESCE(
    (
      SELECT jsonb_agg(scope_value)
      FROM jsonb_array_elements_text("oauth_authorization_codes"."requested_scopes") AS elems(scope_value)
      WHERE NOT EXISTS (
        SELECT 1 FROM obsolete WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
      )
    ),
    '[]'::jsonb
  ),
  "scopes" = COALESCE(
    (
      SELECT jsonb_agg(scope_value)
      FROM jsonb_array_elements_text("oauth_authorization_codes"."scopes") AS elems(scope_value)
      WHERE NOT EXISTS (
        SELECT 1 FROM obsolete WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
      )
    ),
    '[]'::jsonb
  )
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text("oauth_authorization_codes"."requested_scopes") AS elems(scope_value), obsolete
  WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
)
OR EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text("oauth_authorization_codes"."scopes") AS elems(scope_value), obsolete
  WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
);

WITH obsolete(scope) AS (
  VALUES
    ('pki:ca:list:root'),
    ('pki:ca:list:intermediate'),
    ('pki:cert:list'),
    ('pki:templates:list'),
    ('proxy:list'),
    ('ssl:cert:list'),
    ('acl:list'),
    ('nodes:list'),
    ('docker:containers:list'),
    ('docker:images:list'),
    ('docker:volumes:list'),
    ('docker:networks:list'),
    ('docker:registries:list'),
    ('databases:list'),
    ('notifications:alerts:list'),
    ('notifications:webhooks:list'),
    ('notifications:deliveries:list'),
    ('logs:environments:list'),
    ('logs:tokens:list'),
    ('logs:schemas:list')
)
UPDATE "oauth_refresh_tokens"
SET "scopes" = COALESCE(
  (
    SELECT jsonb_agg(scope_value)
    FROM jsonb_array_elements_text("oauth_refresh_tokens"."scopes") AS elems(scope_value)
    WHERE NOT EXISTS (
      SELECT 1 FROM obsolete WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
    )
  ),
  '[]'::jsonb
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text("oauth_refresh_tokens"."scopes") AS elems(scope_value), obsolete
  WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
);

WITH obsolete(scope) AS (
  VALUES
    ('pki:ca:list:root'),
    ('pki:ca:list:intermediate'),
    ('pki:cert:list'),
    ('pki:templates:list'),
    ('proxy:list'),
    ('ssl:cert:list'),
    ('acl:list'),
    ('nodes:list'),
    ('docker:containers:list'),
    ('docker:images:list'),
    ('docker:volumes:list'),
    ('docker:networks:list'),
    ('docker:registries:list'),
    ('databases:list'),
    ('notifications:alerts:list'),
    ('notifications:webhooks:list'),
    ('notifications:deliveries:list'),
    ('logs:environments:list'),
    ('logs:tokens:list'),
    ('logs:schemas:list')
)
UPDATE "oauth_access_tokens"
SET "scopes" = COALESCE(
  (
    SELECT jsonb_agg(scope_value)
    FROM jsonb_array_elements_text("oauth_access_tokens"."scopes") AS elems(scope_value)
    WHERE NOT EXISTS (
      SELECT 1 FROM obsolete WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
    )
  ),
  '[]'::jsonb
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text("oauth_access_tokens"."scopes") AS elems(scope_value), obsolete
  WHERE scope_value = obsolete.scope OR scope_value LIKE obsolete.scope || ':%'
);
