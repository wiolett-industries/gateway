# Permission Scopes

All scopes follow the naming convention `domain:resource:action[:qualifier]`.

Scopes marked **Yes** in the "Restrictable" column can be limited to a specific resource (e.g. `docker:containers:view:node-uuid` restricts view to that node only).

## Builtin Groups

| Group | Description |
|-------|-------------|
| **system-admin** | All 82 scopes including `admin:system` |
| **admin** | All scopes except `admin:system` |
| **operator** | Operational access (PKI, proxy, SSL, ACL, nodes, Docker containers, AI) |
| **viewer** | Read-only access (list + view scopes only) |

---

## PKI: Certificate Authorities

| Scope | Description | Restrictable |
|-------|-------------|---|
| `pki:ca:list:root` | List root certificate authorities | |
| `pki:ca:list:intermediate` | List intermediate certificate authorities | |
| `pki:ca:view:root` | View root CA details, keys, and OCSP config | |
| `pki:ca:view:intermediate` | View intermediate CA details | |
| `pki:ca:create:root` | Create new root certificate authorities | |
| `pki:ca:create:intermediate` | Create intermediate CAs under a root | Yes |
| `pki:ca:revoke:root` | Revoke and delete root CAs | |
| `pki:ca:revoke:intermediate` | Revoke and delete intermediate CAs | |

## PKI: Certificates

| Scope | Description | Restrictable |
|-------|-------------|---|
| `pki:cert:list` | List issued certificates | |
| `pki:cert:view` | View certificate details and chain | |
| `pki:cert:issue` | Issue new certificates from a CA | Yes |
| `pki:cert:revoke` | Revoke issued certificates | Yes |
| `pki:cert:export` | Export certificates and private keys | Yes |

## PKI: Certificate Templates

| Scope | Description | Restrictable |
|-------|-------------|---|
| `pki:templates:list` | List certificate templates | |
| `pki:templates:view` | View certificate template details | |
| `pki:templates:create` | Create certificate templates | |
| `pki:templates:edit` | Edit certificate templates | |
| `pki:templates:delete` | Delete certificate templates | |

## Proxy Hosts

| Scope | Description | Restrictable |
|-------|-------------|---|
| `proxy:list` | List and search proxy hosts | |
| `proxy:view` | View proxy host details | Yes |
| `proxy:create` | Create new proxy hosts | Yes |
| `proxy:edit` | Edit proxy host configuration | Yes |
| `proxy:delete` | Delete proxy hosts | Yes |
| `proxy:raw:read` | View raw nginx configuration | Yes |
| `proxy:raw:write` | Edit raw nginx configuration | Yes |
| `proxy:raw:toggle` | Switch between managed and raw config mode | Yes |
| `proxy:advanced` | Use advanced proxy configuration options | Yes |

## SSL Certificates

| Scope | Description | Restrictable |
|-------|-------------|---|
| `ssl:cert:list` | List SSL certificates | |
| `ssl:cert:view` | View SSL certificate details | Yes |
| `ssl:cert:issue` | Provision ACME or upload SSL certificates | |
| `ssl:cert:delete` | Delete SSL certificates | Yes |
| `ssl:cert:revoke` | Revoke SSL certificates | Yes |
| `ssl:cert:export` | Export SSL certificates | Yes |

## Access Control Lists

| Scope | Description | Restrictable |
|-------|-------------|---|
| `acl:list` | List access control lists | |
| `acl:view` | View access list details | Yes |
| `acl:create` | Create access control lists | |
| `acl:edit` | Edit access control lists | Yes |
| `acl:delete` | Delete access control lists | Yes |

## Nodes

| Scope | Description | Restrictable |
|-------|-------------|---|
| `nodes:list` | List managed nodes (supports type filter: `nodes:list:docker`) | |
| `nodes:details` | View node details and monitoring data | Yes |
| `nodes:create` | Enroll new nodes (supports type filter: `nodes:create:docker`) | |
| `nodes:rename` | Rename nodes | Yes |
| `nodes:delete` | Remove nodes | Yes |
| `nodes:config:view` | View node nginx configuration | Yes |
| `nodes:config:edit` | Edit node nginx configuration | Yes |
| `nodes:logs` | View node daemon and nginx logs | Yes |
| `nodes:console` | Open interactive shell on nodes | Yes |

## Administration

| Scope | Description | Restrictable |
|-------|-------------|---|
| `admin:users` | Create, edit, and delete users | |
| `admin:groups` | Create, edit, and delete permission groups | |
| `admin:audit` | View the audit log | |
| `admin:system` | System-level administration (protected, cannot be removed from system-admin) | |
| `admin:details:certificates` | View internal system PKI and SSL certificates in read-only mode | |
| `admin:update` | Check for and apply updates | |
| `admin:housekeeping` | Run housekeeping tasks (prune, cleanup) | |
| `admin:alerts` | View and manage alerts | |

## Features

| Scope | Description | Restrictable |
|-------|-------------|---|
| `feat:ai:use` | Use the AI assistant | |
| `feat:ai:configure` | Configure AI settings and providers | |

## Docker: Containers

| Scope | Description | Restrictable |
|-------|-------------|---|
| `docker:containers:list` | List Docker containers (restrict to node: `:nodeId`) | |
| `docker:containers:view` | View container details, logs, stats, and processes | Yes |
| `docker:containers:create` | Create and duplicate containers | |
| `docker:containers:edit` | Edit container settings (rename, update, live-update) | Yes |
| `docker:containers:manage` | Start, stop, restart, kill, and recreate containers | Yes |
| `docker:containers:environment` | Modify container environment variables | Yes |
| `docker:containers:delete` | Remove containers | Yes |
| `docker:containers:console` | Open interactive console (exec) in containers | Yes |
| `docker:containers:files` | Browse and edit files inside containers | Yes |
| `docker:containers:secrets` | View decrypted secret values and manage secrets | Yes |

## Docker: Images

| Scope | Description | Restrictable |
|-------|-------------|---|
| `docker:images:list` | List Docker images on a node | |
| `docker:images:pull` | Pull Docker images from registries | |
| `docker:images:delete` | Remove and prune Docker images | |

## Docker: Volumes

| Scope | Description | Restrictable |
|-------|-------------|---|
| `docker:volumes:list` | List Docker volumes | |
| `docker:volumes:create` | Create Docker volumes | |
| `docker:volumes:delete` | Remove Docker volumes | |

## Docker: Networks

| Scope | Description | Restrictable |
|-------|-------------|---|
| `docker:networks:list` | List Docker networks | |
| `docker:networks:create` | Create Docker networks | |
| `docker:networks:edit` | Connect and disconnect containers from networks | |
| `docker:networks:delete` | Remove Docker networks | |

## Docker: Registries

| Scope | Description | Restrictable |
|-------|-------------|---|
| `docker:registries:list` | List Docker registries in settings | |
| `docker:registries:create` | Add Docker registries | |
| `docker:registries:edit` | Edit Docker registry settings and test connections | |
| `docker:registries:delete` | Remove Docker registries | |

## Docker: Templates

| Scope | Description | Restrictable |
|-------|-------------|---|
| `docker:templates:list` | List Docker templates | |
| `docker:templates:view` | View Docker template details | |
| `docker:templates:create` | Create Docker templates | |
| `docker:templates:edit` | Edit Docker templates | |
| `docker:templates:delete` | Delete Docker templates | |

## Docker: Tasks

| Scope | Description | Restrictable |
|-------|-------------|---|
| `docker:tasks` | View Docker task progress (filtered to accessible nodes) | |

---

**Total: 83 scopes**
