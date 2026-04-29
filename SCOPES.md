# Permission Scopes

All scopes follow `domain:resource:action[:qualifier]`. Resource-scopable scopes may be limited with a resource suffix, for example `logs:schemas:view:<schemaId>`.

## Built-in Groups

| Group | Description |
|-------|-------------|
| `system-admin` | All 136 scopes, including protected `admin:system`. |
| `admin` | Curated broad access; excludes `admin:system`, `settings:gateway:edit`, `housekeeping:configure`, and Docker registry create/edit/delete defaults. |
| `operator` | Operational access for day-to-day PKI, proxy, SSL, ACL, node, Docker container, database, notification, and logging read/query work. |
| `viewer` | Read-only list/view access. |

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

API tokens cannot be granted `feat:ai:use`, `feat:ai:configure`, or `admin:system`. `admin:system` remains a protected user/group scope for system administrator shielding.
