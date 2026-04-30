# Permission Scopes

All scopes follow `domain:resource:action[:qualifier]`. Resource-scopable scopes may be limited with a resource suffix, for example `logs:schemas:view:<schemaId>`.

## Built-in Groups

| Group | Description |
|-------|-------------|
| `system-admin` | All 136 scopes, including protected `admin:system`. |
| `admin` | Curated broad access; excludes `admin:system`, `settings:gateway:edit`, `housekeeping:configure`, and Docker registry create/edit/delete defaults. |
| `operator` | Operational access for day-to-day PKI, proxy, SSL, ACL, node, Docker container, database, notification, and logging read/query work. |
| `viewer` | Read-only list/view access. |

## Programmatic Access

Gateway has three token families:

| Prefix | Purpose |
|--------|---------|
| `gw_` | API token for REST API automation. |
| `gwo_` | OAuth access token for one OAuth resource. |
| `gwl_` | External logging ingest token. |

OAuth tokens are bound to exactly one resource:

| Resource | URL path | Accepted by |
|----------|----------|-------------|
| Gateway API | `/api` | REST API routes |
| Gateway MCP | `/api/mcp` | Remote MCP endpoint |

The REST API accepts browser sessions, `gw_` API tokens, and `gwo_` OAuth tokens issued for the Gateway API resource. The MCP endpoint accepts only `gwo_` OAuth tokens issued for the Gateway MCP resource; API tokens, browser cookies, and logging tokens are rejected.

Delegated API/OAuth scopes are always bounded by the owning user's current effective scopes. Revoking or editing a user's group permissions also reduces the effective permissions of that user's existing tokens.

## Scope List

| Scope | Resource-scopable |
|-------|-------------------|
| `pki:ca:list:root` |  |
| `pki:ca:list:intermediate` |  |
| `pki:ca:view:root` |  |
| `pki:ca:view:intermediate` |  |
| `pki:ca:create:root` |  |
| `pki:ca:create:intermediate` | Yes |
| `pki:ca:revoke:root` |  |
| `pki:ca:revoke:intermediate` |  |
| `pki:cert:list` |  |
| `pki:cert:view` |  |
| `pki:cert:issue` | Yes |
| `pki:cert:revoke` | Yes |
| `pki:cert:export` | Yes |
| `pki:templates:list` |  |
| `pki:templates:view` |  |
| `pki:templates:create` |  |
| `pki:templates:edit` |  |
| `pki:templates:delete` |  |
| `proxy:list` |  |
| `proxy:view` | Yes |
| `proxy:create` | Yes |
| `proxy:edit` | Yes |
| `proxy:delete` | Yes |
| `proxy:raw:read` | Yes |
| `proxy:raw:write` | Yes |
| `proxy:raw:toggle` | Yes |
| `proxy:advanced` | Yes |
| `proxy:advanced:bypass` | Yes |
| `ssl:cert:list` |  |
| `ssl:cert:view` | Yes |
| `ssl:cert:issue` |  |
| `ssl:cert:delete` | Yes |
| `ssl:cert:revoke` | Yes |
| `ssl:cert:export` | Yes |
| `acl:list` |  |
| `acl:view` | Yes |
| `acl:create` |  |
| `acl:edit` | Yes |
| `acl:delete` | Yes |
| `nodes:list` |  |
| `nodes:details` | Yes |
| `nodes:create` |  |
| `nodes:rename` | Yes |
| `nodes:delete` | Yes |
| `nodes:config:view` | Yes |
| `nodes:config:edit` | Yes |
| `nodes:logs` | Yes |
| `nodes:console` | Yes |
| `nodes:lock` | Yes |
| `admin:users` |  |
| `admin:groups` |  |
| `admin:audit` |  |
| `admin:system` |  |
| `admin:details:certificates` |  |
| `admin:update` |  |
| `admin:alerts` |  |
| `settings:gateway:view` |  |
| `settings:gateway:edit` |  |
| `housekeeping:view` |  |
| `housekeeping:run` |  |
| `housekeeping:configure` |  |
| `license:view` |  |
| `license:manage` |  |
| `feat:ai:use` |  |
| `feat:ai:configure` |  |
| `mcp:use` |  |
| `docker:containers:list` | Yes |
| `docker:containers:view` | Yes |
| `docker:containers:create` | Yes |
| `docker:containers:edit` | Yes |
| `docker:containers:manage` | Yes |
| `docker:containers:environment` | Yes |
| `docker:containers:delete` | Yes |
| `docker:containers:console` | Yes |
| `docker:containers:files` | Yes |
| `docker:containers:secrets` | Yes |
| `docker:containers:webhooks` | Yes |
| `docker:images:list` | Yes |
| `docker:images:pull` | Yes |
| `docker:images:delete` | Yes |
| `docker:volumes:list` | Yes |
| `docker:volumes:create` | Yes |
| `docker:volumes:delete` | Yes |
| `docker:networks:list` | Yes |
| `docker:networks:create` | Yes |
| `docker:networks:edit` | Yes |
| `docker:networks:delete` | Yes |
| `docker:registries:list` |  |
| `docker:registries:create` |  |
| `docker:registries:edit` |  |
| `docker:registries:delete` |  |
| `docker:tasks` |  |
| `databases:list` | Yes |
| `databases:view` | Yes |
| `databases:create` |  |
| `databases:edit` | Yes |
| `databases:delete` | Yes |
| `databases:query:read` | Yes |
| `databases:query:write` | Yes |
| `databases:query:admin` | Yes |
| `databases:credentials:reveal` | Yes |
| `notifications:alerts:list` |  |
| `notifications:alerts:view` |  |
| `notifications:alerts:create` |  |
| `notifications:alerts:edit` |  |
| `notifications:alerts:delete` |  |
| `notifications:webhooks:list` |  |
| `notifications:webhooks:view` |  |
| `notifications:webhooks:create` |  |
| `notifications:webhooks:edit` |  |
| `notifications:webhooks:delete` |  |
| `notifications:deliveries:list` |  |
| `notifications:deliveries:view` |  |
| `notifications:view` |  |
| `notifications:manage` |  |
| `logs:environments:list` |  |
| `logs:environments:view` | Yes |
| `logs:environments:create` |  |
| `logs:environments:edit` | Yes |
| `logs:environments:delete` | Yes |
| `logs:tokens:list` | Yes |
| `logs:tokens:create` | Yes |
| `logs:tokens:delete` | Yes |
| `logs:schemas:list` |  |
| `logs:schemas:view` | Yes |
| `logs:schemas:create` |  |
| `logs:schemas:edit` | Yes |
| `logs:schemas:delete` | Yes |
| `logs:read` | Yes |
| `logs:manage` |  |
| `status-page:view` |  |
| `status-page:manage` |  |
| `status-page:incidents:create` |  |
| `status-page:incidents:update` |  |
| `status-page:incidents:resolve` |  |
| `status-page:incidents:delete` |  |

## API Token Delegation

API and OAuth tokens can be granted 122 of the 136 scopes. They cannot be granted:

| Scope | Reason |
|-------|--------|
| `feat:ai:use` | User/session-only AI assistant access. |
| `feat:ai:configure` | User/session-only AI configuration. |
| `mcp:use` | User-account capability gate for remote MCP. |
| `admin:system` | Protected system-administrator shielding. |
| `admin:users` | User administration is session-only. |
| `admin:groups` | Permission group administration is session-only. |
| `settings:gateway:view` | Gateway auth/control-plane settings are session-only. |
| `settings:gateway:edit` | Gateway auth/control-plane settings are session-only. |
| `proxy:raw:read` | Raw nginx config is session-only. |
| `proxy:raw:write` | Raw nginx config is session-only. |
| `proxy:raw:toggle` | Raw nginx mode is session-only. |
| `proxy:advanced:bypass` | Unrestricted advanced nginx snippets are session-only. |
| `nodes:config:view` | Global node nginx config is session-only. |
| `nodes:config:edit` | Global node nginx config is session-only. |

`mcp:use` is not a token scope. It gates whether the owning user account may use the MCP endpoint at all. MCP tokens use ordinary delegated Gateway scopes such as `nodes:list`, `proxy:view`, or `docker:containers:view` to determine which MCP tools and resources are available.

## OAuth Manual Approval Scopes

OAuth consent leaves high-risk scopes unchecked by default. The user must explicitly select them in the consent UI. Resource-scoped variants are covered by their base scope, for example `pki:cert:export:<certificateId>` is treated as `pki:cert:export`.

| Scope | Risk |
|-------|------|
| `pki:ca:create:root` | Can create trust anchors and currently gates CA private-key export. |
| `pki:ca:create:intermediate` | Can create subordinate CAs. |
| `pki:ca:revoke:root` | Can revoke or delete root CAs. |
| `pki:ca:revoke:intermediate` | Can revoke or delete intermediate CAs. |
| `pki:cert:export` | Can export certificates with private key material. |
| `ssl:cert:issue` | Can upload/provision certificates and private keys. |
| `ssl:cert:delete` | Can remove deployed SSL certificates. |
| `ssl:cert:revoke` | Can revoke SSL certificates. |
| `ssl:cert:export` | Reserved for SSL certificate export capability. |
| `nodes:console` | Can open an interactive shell on nodes. |
| `docker:containers:console` | Can open an interactive console in containers. |
| `docker:containers:files` | Can read and write container filesystem contents. |
| `docker:containers:secrets` | Can reveal and manage encrypted container/deployment secrets. |
| `databases:query:read` | Can read data from saved database connections. |
| `databases:query:write` | Can modify data in saved database connections. |
| `databases:query:admin` | Can run administrative database commands. |
| `databases:credentials:reveal` | Can reveal stored database credentials and connection strings. |
| `logs:tokens:create` | Can mint logging ingest tokens. |
| `admin:audit` | Can read audit history. |
| `admin:details:certificates` | Can view internal system PKI and SSL certificates. |
| `admin:update` | Can check for and apply Gateway/daemon updates. |
