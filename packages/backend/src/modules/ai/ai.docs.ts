import { hasScope } from '@/lib/permissions.js';

export const INTERNAL_DOCS: Record<string, string> = {
  pki: `# PKI (Public Key Infrastructure)

## Certificate Authorities (CAs)
- **Root CA**: Self-signed, top of the trust chain. Created with create_root_ca. Set pathLengthConstraint to limit CA chain depth (0 = can only issue end-entity certs, 1 = can create one level of intermediate CAs).
- **Intermediate CA**: Signed by a parent CA. Created with create_intermediate_ca(parentCaId, ...). Recommended for issuing end-entity certificates.
- Key algorithms: rsa-2048, rsa-4096, ecdsa-p256, ecdsa-p384.
- CAs can be revoked (permanent) or deleted (only if no certs issued).
- Each CA has: commonName, keyAlgorithm, validityYears, maxValidityDays (max validity for certs it issues).

## PKI Certificates
- Issued by a CA using issue_certificate.
- Types: tls-server (web/SSL), tls-client (client auth), code-signing, email (S/MIME).
- Fields: caId, commonName, keyAlgorithm, validityDays, type, sans (Subject Alternative Names).
- SANs: array of PLAIN strings — just the value, NO type prefix. Examples: "example.com", "*.example.com", "10.0.0.1", "user@example.com". The system auto-detects the type (dns/ip/email/url). NEVER use "DNS:", "IP:", or other prefixes — they will cause errors.
- Certificates can be revoked with a reason (key_compromise, superseded, unspecified, etc.).
- Private keys are generated server-side and encrypted at rest.

## PKI → SSL Workflow
PKI certificates live in a separate store from SSL certificates. To use a PKI cert with a proxy host:
1. issue_certificate → returns { certificate, message }
2. link_internal_cert(internalCertId: certificate.id) → creates an SSL certificate entry
3. Use the SSL certificate ID (from step 2) when creating/updating proxy hosts.
NEVER use a PKI certificate ID directly as sslCertificateId on a proxy host.`,

  ssl: `# SSL Certificates

SSL certificates in Gateway are used to enable HTTPS on proxy hosts. Three types exist:

## Types
1. **ACME** (Let's Encrypt): Automated free certificates via request_acme_cert. Requires domain verification. Auto-renewable.
2. **Upload**: Manually uploaded PEM certificate + private key via upload_ssl_cert. No auto-renewal — must be re-uploaded before expiry.
3. **Internal**: Linked from PKI store via link_internal_cert(internalCertId). Uses the PKI cert's key material. Renewed by re-issuing the PKI cert and re-linking.

## ACME Certificates (Let's Encrypt)
- request_acme_cert({ domains: ["example.com", "www.example.com"], challengeType: "http-01" })
- **http-01**: Gateway automatically serves the challenge at /.well-known/acme-challenge/ on port 80. The daemon deploys challenge files to nginx. Port 80 must be publicly accessible.
- **dns-01**: For wildcard certs or when port 80 is blocked. Returns { domain, recordName, recordValue } — user must create a DNS TXT record manually, then confirm.
- Auto-renew: checked daily at 3 AM. Renews certificates 30 days before expiry.
- Staging mode available for testing (certs not browser-trusted).

## Uploading Custom Certificates
- upload_ssl_cert({ certificatePem, privateKeyPem, chainPem? })
- Chain PEM is optional (intermediate CA chain).
- Expiry is parsed from the certificate — no auto-renewal.

## Using PKI Certificates as SSL
To use a PKI-issued certificate with a proxy host:
1. Issue a PKI certificate: issue_certificate(...) → returns cert with id
2. Link it: link_internal_cert(internalCertId: cert.id) → creates an SSL certificate entry with a separate ID
3. Use the SSL certificate ID (from step 2) as sslCertificateId on the proxy host
IMPORTANT: Never use a PKI certificate ID directly as sslCertificateId — you must link it first.

## Using SSL Certs with Proxy Hosts
- Set sslCertificateId on the proxy host to the SSL certificate UUID.
- Set sslEnabled: true to enable HTTPS.
- sslForced: true redirects all HTTP traffic to HTTPS (301 redirect).
- http2Support: true enables HTTP/2 (recommended with SSL).

## Certificate Deployment
When an SSL cert is assigned to a proxy host, Gateway:
1. Pushes the cert/key files to the nginx daemon node
2. Updates the nginx config to reference the cert files
3. Tests the config (nginx -t)
4. Reloads nginx to apply`,

  proxy: `# Reverse Proxy Hosts

## Types
- **proxy**: Forward requests to a backend server (forwardHost:forwardPort).
- **redirect**: Redirect to a URL (redirectUrl, redirectStatusCode: 301/302).
- **404**: Return 404 for all requests (used to block domains).

## Key Fields
- nodeId: the daemon node this host is deployed on (required when creating).
- domainNames: array of domains this host serves.
- forwardHost/forwardPort/forwardScheme: backend server details (for proxy type).
- sslEnabled: enable HTTPS. Requires sslCertificateId (SSL cert UUID, NOT PKI cert UUID).
- sslForced: redirect HTTP to HTTPS.
- http2Support: enable HTTP/2.
- websocketSupport: enable WebSocket proxying.
- accessListId: attach an access list for IP/auth restrictions.
- healthCheckEnabled: monitor backend availability.
- advancedConfig: raw nginx config snippet (advanced users only).
- rawConfigEnabled: bypass template rendering and use rawConfig directly.
- rawConfig: custom nginx configuration content (used when rawConfigEnabled is true).
- enabled: toggle host on/off without deleting.
- folderId: organize into folders.
- nginxTemplateId: use a custom nginx template.

## Nginx Config
Each proxy host generates an nginx server block. Changes are applied by reloading nginx.
Config templates can customize the generated config (see templates topic).

## Raw Config Mode
When rawConfigEnabled is true, the template rendering is bypassed and rawConfig is used directly as the nginx server block. Use get_proxy_rendered_config to view the current config, toggle_proxy_raw_mode to enable/disable, and update_proxy_raw_config to write raw config.`,

  domains: `# Domains

Domains track DNS records and validation status for domains used across Gateway.

## Purpose
- Track which domains point to your Gateway servers (DNS A/AAAA records)
- Verify DNS is correctly configured before creating proxy hosts
- Monitor DNS changes over time
- Required for ACME HTTP-01 challenges (domain must resolve to Gateway)

## Lifecycle
1. Register a domain: createDomain({ domain: "example.com" })
2. Gateway checks DNS records automatically every 5 minutes
3. Status: pending → valid (DNS resolves correctly) or invalid (DNS misconfigured)
4. Use checkDns to manually trigger an immediate re-check

## DNS Records Tracked
- **A**: IPv4 address — should point to your Gateway/nginx node IP
- **AAAA**: IPv6 address
- **CNAME**: Canonical name (alias to another domain)
- **CAA**: Certificate Authority Authorization — controls which CAs can issue certs
- **MX**: Mail exchange records
- **TXT**: Text records (used for DNS-01 ACME challenges, SPF, DKIM, etc.)

## Rules
- Domains used by proxy hosts cannot be deleted (remove from proxy first)
- isSystem domains (management domains) cannot be deleted
- Wildcard domains (*.example.com) can be registered but DNS checks apply to the base domain`,

  'access-lists': `# Access Lists

Access lists provide IP-based access control and HTTP basic authentication for proxy hosts.

## How It Works
1. Create an access list with IP rules and/or basic auth users
2. Attach it to one or more proxy hosts via accessListId
3. Nginx enforces the rules on every request to those proxy hosts

## IP Rules
- Array of rules: { type: "allow"|"deny", value: "CIDR or IP" }
- Examples: { type: "allow", value: "10.0.0.0/8" }, { type: "deny", value: "0.0.0.0/0" }
- Rules are evaluated in order — first match wins
- Common pattern: allow specific IPs/ranges, deny all others

## Basic Authentication
- basicAuthEnabled: true to enable HTTP basic auth
- basicAuthUsers: array of { username, password }
- Passwords are hashed with bcrypt before storage in htpasswd format
- Htpasswd files are deployed to nginx nodes via daemon

## Satisfy Mode
- **"any"** (default): request passes if IP matches OR auth succeeds (logical OR)
- **"all"**: request must satisfy BOTH IP rules AND auth (logical AND)

## Usage
- One access list can be shared across multiple proxy hosts
- Changing an access list automatically updates all proxy hosts using it
- Deleting an access list detaches it from all hosts first`,

  templates: `# Certificate Templates

Templates define preset configurations for issuing PKI certificates. They save time and enforce consistency.

## How Templates Work
1. Admin creates a template with desired settings (cert type, key algorithm, validity, key usage, etc.)
2. When issuing a certificate, select the template — its settings become defaults
3. Settings can still be overridden per-certificate at issue time

## Template Fields
- **certType**: tls-server, tls-client, code-signing, email
- **keyAlgorithm**: rsa-2048, rsa-4096, ecdsa-p256, ecdsa-p384
- **validityDays**: default validity period (1-3650 days)
- **keyUsage**: digitalSignature, keyEncipherment, dataEncipherment, keyAgreement, nonRepudiation
- **extKeyUsage**: serverAuth, clientAuth, codeSigning, emailProtection, timeStamping, ocspSigning (plus custom OIDs)
- **requireSans**: whether SANs are mandatory when issuing
- **sanTypes**: allowed SAN types (dns, ip, email, uri)
- **subjectDnFields**: default Organization, OU, Locality, State, Country for the certificate subject
- **crlDistributionPoints**: URLs for CRL download
- **authorityInfoAccess**: OCSP responder URL and CA Issuers URL
- **certificatePolicies**: policy OIDs with optional CPS qualifier URLs
- **customExtensions**: arbitrary X.509 extensions by OID (hex-encoded DER values)

## Built-in Templates
- isBuiltin: true — provided by default, cannot be edited or deleted
- Common presets: TLS Server, TLS Client, Code Signing, Email

## Nginx Config Templates
Separate from certificate templates — these define nginx server block templates for proxy hosts.
- Each template has a type (reverse-proxy, redirect, static-site, etc.)
- Templates use variable syntax ({{variableName}}) for dynamic values
- Can be cloned and customized
- Assigned to proxy hosts via nginxTemplateId`,

  acme: `# ACME (Automated Certificate Management)

Let's Encrypt integration for free, automated SSL certificates.

## Issuing an ACME Certificate
1. request_acme_cert({ domains: ["example.com", "www.example.com"], challengeType: "http-01" })
2. Gateway contacts Let's Encrypt, receives a challenge
3. For http-01: Gateway deploys challenge files to nginx nodes automatically, Let's Encrypt verifies
4. For dns-01: Gateway returns { domain, recordName, recordValue } — user creates DNS TXT record, then confirms
5. Certificate is issued and stored as an SSL certificate

## Challenge Types
- **http-01** (recommended): Fully automatic. Gateway serves the challenge at \`/.well-known/acme-challenge/\` on port 80. Requires: port 80 publicly accessible, domain resolving to nginx node IP.
- **dns-01**: For wildcard certificates (*.example.com) or when port 80 is blocked. Manual step: add a TXT record at \`_acme-challenge.example.com\`. Supports wildcard issuance.

## Auto-Renewal
- Checked daily at 3 AM (configurable via ACME_RENEWAL_CRON setting)
- Renews certificates 30 days before expiry
- Uses the same challenge type as the original issuance
- Renewal failures are logged and alerted

## Staging Mode
- ACME_STAGING=true in settings uses Let's Encrypt staging servers
- Certificates are NOT trusted by browsers (for testing only)
- Useful for testing ACME flow without hitting rate limits
- Rate limits: 50 certs per registered domain per week (production)

## Troubleshooting
- **Challenge fails**: Verify domain resolves to your nginx node IP (check Domains page). Ensure port 80 is open and not blocked by firewall.
- **DNS-01 fails**: Verify TXT record is propagated (use dig or nslookup). TTL must be low enough for timely propagation.
- **Rate limited**: Switch to staging for testing. Production limit: 5 duplicate certs per week, 50 per domain per week.
- **Renewal fails**: Check daemon logs on the nginx node. Verify the node is online and connected.`,

  users: `# User Management

## Authentication
Users authenticate via OIDC (OpenID Connect). Gateway acts as a relying party — it does not store passwords.
- OIDC provider configured in Settings (issuer URL, client ID, client secret)
- First login auto-creates the user in the default permission group
- Subsequent logins update the user's name and avatar from the OIDC provider

## Permission Groups
- Every user belongs to exactly one permission group
- Groups define which scopes (permissions) the user has
- **Built-in groups** (cannot be modified): system-admin, admin, operator, viewer
- **Custom groups**: created by admins with any combination of scopes
- **Group nesting**: a group can inherit from one parent group (single level only). Inherited scopes are automatically added to the user's effective scopes.
- Nesting limit: only top-level groups can be parents — a nested group cannot itself have children

## Managing Users
- View all users: list_users
- Change a user's group: update_user_role(userId, groupId) — changes their permissions immediately
- Block a user: update_user(userId, { isBlocked: true }) — blocked users see a "blocked" page after login and cannot use any features
- Users cannot be deleted (they're linked to audit logs), only blocked

## User Fields
- id, email, name, avatarUrl, groupId, groupName, scopes, isBlocked
- lastLoginAt, loginCount, createdAt`,

  audit: `# Audit Log

All significant actions are logged.
- Fields: userId, action, resourceType, resourceId, details (JSON), ipAddress, userAgent, createdAt.
- Actions follow pattern: "resource.action" (e.g., "ca.create", "cert.revoke", "proxy.update").
- AI-initiated actions have details.ai_initiated: true.
- Query with get_audit_log: filter by action, resourceType, pagination.
- Housekeeping can auto-delete old entries (configurable retention).`,

  nginx: `# Nginx Management

Gateway manages nginx reverse proxies through daemon nodes running on remote servers.

## Architecture
- Each nginx node runs a Go daemon (\`nginx-daemon\`) alongside the host's native nginx installation
- The Gateway backend communicates with daemons over gRPC (port 9443) with mutual TLS
- Proxy hosts are assigned to specific nginx nodes — each host's config is generated by Gateway and pushed to the daemon
- The daemon writes the config files, tests with \`nginx -t\`, and reloads nginx gracefully

## Config Management
- Proxy host configs are generated from templates and written to the nginx \`conf.d/sites/\` directory
- Each proxy host becomes one nginx server block file
- Changes are atomic: write → test → reload (rollback on test failure)
- Global nginx.conf can be viewed and edited from the node detail page (Configuration tab)

## Config Templates
- Nginx templates define the server block structure for proxy hosts
- Built-in templates for common patterns (reverse proxy, redirect, etc.)
- Custom templates support variables: \`{{variableName}}\` replaced at render time
- Assigned to proxy hosts via nginxTemplateId — default template used if none specified

## Raw Config Mode
- When rawConfigEnabled is true on a proxy host, the template rendering is bypassed entirely
- The rawConfig field is used directly as the nginx server block content
- Useful for complex configurations that templates can't express
- Requires proxy:raw:toggle and proxy:raw:write scopes
- Use get_proxy_rendered_config to see the current generated config before switching to raw mode

## Monitoring
- **Stub status**: nginx stub_status module provides active connections, accepts, handled, requests, reading, writing, waiting
- **Access log parsing**: traffic stats by status code, response times, bandwidth
- **Health checks**: per-proxy-host backend health monitoring (configurable URL, interval, expected status)
- **Nginx logs**: access and error logs streamed via daemon, viewable per proxy host or per node

## SSL/TLS
- SSL certificates are deployed to nginx nodes as PEM files in the certs directory
- Config includes ssl_certificate and ssl_certificate_key directives
- HTTP/2 support togglable per proxy host
- OCSP stapling enabled by default when CA chain is available`,

  nodes: `# Nodes (Daemon Management)

Nodes are remote servers running Gateway daemons. Each daemon type manages different infrastructure.

## Node Types
- **nginx**: Reverse proxy node — runs nginx, manages proxy host configs, SSL certs, access lists. Requires nginx installed on the server.
- **monitoring**: Lightweight system monitoring agent — reports CPU, memory, disk, load, network. No nginx required. Useful for any server you want to monitor.
- **docker**: Container management node — manages Docker containers, images, volumes, networks. Requires Docker installed. Provides container console (exec), file browser, log streaming, environment/secrets management.

## How to Enroll a New Node (Step by Step)

### Step 1: Create the node in Gateway UI
Go to **Nodes** page → click **Enroll Node** → select the node type (nginx, docker, or monitoring) → optionally set a display name → click **Create**. This generates a **one-time enrollment token** and shows setup commands.

### Step 2: Run the setup script on the target server
The UI shows ready-to-copy commands. Run one of these on the target server as root:

For **nginx** nodes:
\`\`\`bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-node.sh | sudo bash -s -- \\
  --gateway <gateway-host>:9443 --token <enrollment-token>
\`\`\`

For **docker** nodes:
\`\`\`bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-docker-node.sh | sudo bash -s -- \\
  --gateway <gateway-host>:9443 --token <enrollment-token>
\`\`\`

For **monitoring** nodes:
\`\`\`bash
curl -sSL https://gitlab.wiolett.net/wiolett/gateway/-/raw/main/scripts/setup-monitoring-node.sh | sudo bash -s -- \\
  --gateway <gateway-host>:9443 --token <enrollment-token>
\`\`\`

The setup script:
1. Downloads the daemon binary to \`/usr/local/bin/<type>-daemon\`
2. Creates config at \`/etc/<type>-daemon/config.yaml\` with the gateway address and token
3. Creates a systemd service and enables it
4. Starts the daemon — it connects to the gateway and completes mTLS enrollment automatically

### Step 3: Verify connection
The node status changes from **pending** to **online** in the Nodes list once the daemon connects. The enrollment token is invalidated after first use.

### Alternative: Manual installation
If you cannot use the setup script, you can install manually:
1. Download the daemon binary and place it at \`/usr/local/bin/<type>-daemon\`
2. Run: \`<type>-daemon install --gateway <host>:9443 --token <token>\`
   This creates the config file and systemd service automatically.
3. Enable and start: \`systemctl enable --now <type>-daemon\`

## Connection & Communication
- Daemons connect to the gateway via **gRPC on port 9443** with mutual TLS (mTLS).
- The gateway pushes commands to daemons: apply config, deploy certs, health check, log streaming, exec, etc.
- The daemon sends back: health reports (every 30s), command results, log entries, exec output.
- Daemons auto-reconnect on disconnect with exponential backoff (1s → 60s).
- mTLS certificates auto-renew when within 7 days of expiry.

## Console (Interactive Shell)
All node types support an interactive console — a PTY shell session on the host OS.
- Accessed via the **Console** tab on the node detail page.
- Requires \`nodes:console\` scope.
- Supports popout window, reconnection with output replay, and terminal resize.
- Shell auto-detected from \`/etc/shells\` (prefers bash > zsh > ash > sh).
- Can be configured to run as a specific OS user via \`console.user\` in daemon config.

## System Information
Daemons report hardware/OS info on registration:
- CPU model, core count, architecture (amd64, arm64)
- Kernel version, hostname, OS info
- Uptime, file descriptor usage
- Disk mounts with usage percentages
- Network interfaces with RX/TX stats

## Monitoring & Health
- **Health reports** (every 30s): CPU%, memory, disk, load average, swap, network I/O, open FDs.
- **Nginx nodes** additionally report: nginx status, uptime, worker count, error rates (4xx/5xx), stub status stats.
- **Docker nodes** additionally report: container count (running/stopped/total), per-container CPU/memory/network stats, Docker version.
- **Traffic stats** (nginx only): parsed from access logs — status code distribution, response times.
- Background polling at 10s intervals; 5s when a user is actively viewing the node detail page.

## Node Management
- **Rename**: change display name (does not affect hostname).
- **Delete**: removes the node from Gateway. The daemon will fail to reconnect (mTLS cert becomes invalid).
- **Pin to sidebar**: quick-access link in the sidebar navigation.
- **Default node**: one nginx node can be marked as default — used for proxy operations when no specific node is selected.

## Key Fields
- id, hostname, displayName, type, status (pending/online/offline/error)
- lastSeenAt, capabilities (daemon version, features, system info)
- certificateSerial (mTLS cert), enrollmentTokenHash
- metadata (extensible metadata object)`,

  housekeeping: `# Housekeeping

Automated cleanup tasks, configurable in Settings.
- Schedule: cron expression (default: "0 2 * * *" — 2 AM daily).
- Tasks:
  - Nginx Logs: rotate/compress/delete old log files. Retention in days.
  - Audit Log: delete entries older than retention days.
  - Dismissed Alerts: remove old dismissed alerts.
  - Orphaned Certs: remove unreferenced certificate files.
  - ACME Challenges: clean up old validation tokens.
  - Docker Prune: remove unused Docker images.
- Can be triggered manually from Settings page.
- Run history tracked (last N runs with per-category results).`,

  permissions: `# Permissions & Scopes

Gateway uses a group-based permission system with nested group inheritance. Each user belongs to a permission group that defines their scopes. Groups can inherit from parent groups, forming a hierarchy.

## All Scopes

### PKI: Certificate Authorities
| Scope | Description |
|-------|-------------|
| pki:ca:list:root | List root CAs |
| pki:ca:list:intermediate | List intermediate CAs |
| pki:ca:view:root | View root CA details |
| pki:ca:view:intermediate | View intermediate CA details |
| pki:ca:create:root | Create root CAs |
| pki:ca:create:intermediate | Create intermediate CAs (resource-scopable) |
| pki:ca:revoke:root | Revoke root CAs |
| pki:ca:revoke:intermediate | Revoke intermediate CAs |

### PKI: Certificates
| Scope | Description |
|-------|-------------|
| pki:cert:list | List PKI certificates |
| pki:cert:view | View certificate details |
| pki:cert:issue | Issue certificates from a CA (resource-scopable) |
| pki:cert:revoke | Revoke certificates |
| pki:cert:export | Download certificate files and private keys |

### PKI: Certificate Templates
| Scope | Description |
|-------|-------------|
| pki:templates:list | List certificate templates |
| pki:templates:view | View template details |
| pki:templates:create | Create templates |
| pki:templates:edit | Edit templates |
| pki:templates:delete | Delete templates |

### Reverse Proxy
| Scope | Description |
|-------|-------------|
| proxy:list | List proxy hosts |
| proxy:view | View proxy host details (resource-scopable) |
| proxy:create | Create proxy hosts (resource-scopable) |
| proxy:edit | Update proxy hosts (resource-scopable) |
| proxy:delete | Delete proxy hosts (resource-scopable) |
| proxy:raw:read | View rendered nginx config (resource-scopable) |
| proxy:raw:write | Write raw nginx config (resource-scopable) |
| proxy:raw:toggle | Enable/disable raw config mode (resource-scopable) |
| proxy:advanced | Edit advanced nginx snippets (resource-scopable) |
| proxy:advanced:bypass | Bypass advanced nginx snippet restrictions (resource-scopable) |

### SSL Certificates
| Scope | Description |
|-------|-------------|
| ssl:cert:list | List SSL certificates |
| ssl:cert:view | View SSL certificate details |
| ssl:cert:issue | Request ACME / upload / link internal certs |
| ssl:cert:delete | Delete SSL certificates (resource-scopable) |
| ssl:cert:revoke | Revoke SSL certificates (resource-scopable) |
| ssl:cert:export | Export SSL certificates (resource-scopable) |

### Access Control Lists
| Scope | Description |
|-------|-------------|
| acl:list | List access lists |
| acl:view | View access list details |
| acl:create | Create access lists |
| acl:edit | Edit access lists (resource-scopable) |
| acl:delete | Delete access lists (resource-scopable) |

### Nodes
| Scope | Description |
|-------|-------------|
| nodes:list | List daemon nodes |
| nodes:details | View node details, health, stats (resource-scopable) |
| nodes:create | Create/enroll new nodes |
| nodes:rename | Rename a node (resource-scopable) |
| nodes:delete | Delete a node (resource-scopable) |
| nodes:config:view | View node nginx config (resource-scopable) |
| nodes:config:edit | Edit node nginx config (resource-scopable) |
| nodes:logs | View daemon/nginx logs (resource-scopable) |
| nodes:console | Open interactive shell (resource-scopable) |

### Administration
| Scope | Description |
|-------|-------------|
| admin:users | Manage users and permission groups |
| admin:groups | Manage permission groups |
| admin:audit | View audit log |
| admin:system | System-level administration (protected) |
| admin:update | Apply system updates |
| admin:housekeeping | Configure housekeeping tasks |
| admin:alerts | View and manage alerts |

### Features
| Scope | Description |
|-------|-------------|
| feat:ai:use | Access the AI assistant |
| feat:ai:configure | Configure AI assistant settings |

### Docker: Containers
| Scope | Description |
|-------|-------------|
| docker:containers:list | List containers on a node |
| docker:containers:view | View container details (resource-scopable) |
| docker:containers:create | Create/deploy containers |
| docker:containers:edit | Edit container settings (resource-scopable) |
| docker:containers:manage | Start/stop/restart/kill/update containers (resource-scopable) |
| docker:containers:environment | View/edit container environment variables (resource-scopable) |
| docker:containers:delete | Remove containers (resource-scopable) |
| docker:containers:console | Open exec terminal (resource-scopable) |
| docker:containers:files | Browse/edit container files (resource-scopable) |
| docker:containers:secrets | Manage encrypted secrets (resource-scopable) |
| docker:containers:webhooks | Configure CI/CD webhook URLs |

### Docker: Images
| Scope | Description |
|-------|-------------|
| docker:images:list | List images on a node |
| docker:images:pull | Pull images from registries |
| docker:images:delete | Remove/prune images |

### Docker: Volumes
| Scope | Description |
|-------|-------------|
| docker:volumes:list | List volumes |
| docker:volumes:create | Create volumes |
| docker:volumes:delete | Remove volumes |

### Docker: Networks
| Scope | Description |
|-------|-------------|
| docker:networks:list | List networks |
| docker:networks:create | Create networks |
| docker:networks:edit | Connect/disconnect containers |
| docker:networks:delete | Remove networks |

### Docker: Registries
| Scope | Description |
|-------|-------------|
| docker:registries:list | List private registries |
| docker:registries:create | Add registries |
| docker:registries:edit | Edit/test registries |
| docker:registries:delete | Remove registries |

### Docker: Tasks
| Scope | Description |
|-------|-------------|
| docker:tasks | View background tasks |

## Built-in Groups

| Group | Description |
|-------|-------------|
| system-admin | Full access including admin:system |
| admin | All scopes except admin:system |
| operator | Operational access — PKI, proxy, SSL, ACL, nodes, Docker containers, AI |
| viewer | Read-only — list/view scopes for PKI, proxy, SSL, Docker containers |

Custom groups can be created with any combination of scopes.

## Nested Groups & Inheritance
Groups can have a parent group. Inherited scopes from all ancestors are added to the effective scopes. Cycle detection prevents circular inheritance. Built-in groups cannot be modified.

## Resource-Scoped Permissions
Scopes marked "resource-scopable" support resource-level suffixes (e.g., "pki:cert:issue:ca-uuid", "nodes:details:node-uuid", "docker:containers:view:container-id"). Without a suffix, the scope applies to all resources.

## Scope Containment Rule
A user can only manage another user whose scopes are a subset of their own.`,

  docker: `# Docker Container Management

## Overview
Gateway provides Portainer-like Docker container management through a daemon running on Docker hosts. All Docker operations are node-scoped — you must specify which Docker node to target.

## Container Lifecycle
- **Create**: Deploy from image with ports, volumes, env, networks, restart policy
- **Start/Stop/Restart/Kill**: Lifecycle management (transitions tracked as tasks)
- **Recreate**: Stop + remove + create with new config (preserves name, secrets auto-injected)
- **Duplicate**: Clone a container with a new name (secrets are copied too)
- **Remove**: Delete container (must be stopped unless force=true)

## Environment Variables & Secrets
- Regular env vars: stored in container config, visible to all users with view access
- Secrets: encrypted at rest in Gateway DB, injected as env vars on container start/recreate. Only users with docker:containers:secrets scope can view decrypted values. Secrets are keyed by container name so they survive recreates.

## Image Updates & Webhooks
- **Manual image tag change**: in container Settings, the Image Tag field allows changing the version. Changing the tag and clicking Recreate will pull the new image and recreate the container.
- **Webhook updates**: each container can have a webhook URL enabled (Settings → Webhook section). CI pipelines POST to the webhook URL to trigger automatic pull + recreate. URL format: \`POST /api/webhooks/docker/<token>\` with optional body \`{"tag":"v1.2.3"}\`. No auth header needed — the token in the URL is the auth.
- **Auto-cleanup**: webhook config supports automatic cleanup of old image versions after updates, with configurable retention count.
- Webhook configuration requires the \`docker:containers:webhooks\` scope.
- Use \`update_docker_container_image\` tool to change a container's image tag programmatically (pulls + recreates).

## Settings
- **Runtime (live-update)**: restart policy, memory limit, CPU shares, PID limit — applied without recreation
- **Requires recreate**: port mappings, volume mounts, entrypoint, command, working dir, hostname, labels, image tag

## Images, Volumes, Networks
- Images: list, pull from registries, remove, prune unused
- Volumes: list, create, remove (shows which containers use each volume)
- Networks: list, create, remove, connect/disconnect containers

## Registries & Templates
- Registries: add private Docker registries with encrypted credentials. Global or node-specific scope.
- Templates: save container configurations as reusable templates for quick deployment

## Tasks
Long-running operations (stop, restart, kill, recreate, update) create tasks visible on the Tasks page. Tasks track progress and completion status.

## Console & Files
- Console: interactive terminal (exec) into running containers via xterm.js WebSocket
- File browser: navigate filesystem, view/edit files inside containers

## Key Notes
- All Docker tools require a nodeId parameter — use list_nodes with type="docker" to find Docker nodes
- Container IDs change after recreate/update — the frontend handles navigation to new IDs
- Transition states (stopping, restarting, recreating, etc.) block concurrent operations on the same container`,

  databases: `# Databases

## Overview
Gateway can store and operate external Postgres and Redis connections directly from the backend. No daemon is involved.

## Providers
- **Postgres**: schema/table explorer, paginated row browser, row insert/update/delete for PK-backed tables, SQL console, monitoring.
- **Redis**: key browser, type-aware viewer/editor for common types (string, hash, list, set, zset), Redis command console, monitoring.

## Credentials
- Connection credentials are encrypted at rest in the Gateway database using the same envelope-encryption primitive used for Docker secrets and PKI keys.
- Raw credentials are hidden by default. Revealing them requires the \`databases:credentials:reveal\` scope.
- Team members can operate databases through Gateway without being given the raw hosting credentials.

## Permissions
- \`databases:list\`, \`databases:view\`, \`databases:create\`, \`databases:edit\`, \`databases:delete\`
- \`databases:query:read\`, \`databases:query:write\`, \`databases:query:admin\`
- \`databases:credentials:reveal\`
- Most database scopes are resource-scopable by database ID, so access can be limited per saved connection.

## Monitoring
- Gateway stores short rolling metric history for database sparklines and persists health-history entries for health bars.
- Postgres metrics include latency and active connection utilization.
- Redis metrics include latency and memory utilization.

## Audit
- Connection CRUD, connection tests, credential reveals, data mutations, and console executions are audit logged.
- Query text and command text are sanitized and truncated in the audit log to avoid leaking secrets.`,

  postgres: `# Postgres in Gateway

## Explorer
- Schemas and tables are discovered from \`information_schema\`.
- Row editing in the visual explorer requires a primary key. Tables or views without a PK are browse-only in the explorer.
- Explorer pages are paginated; use the SQL console for advanced filtering or bulk operations.

## SQL Console
- One or more SQL statements can be executed per request.
- Read, write, and admin statements are separated by permissions: \`databases:query:read\`, \`databases:query:write\`, and \`databases:query:admin\`.

## Monitoring
- Health is based on connectivity and latency.
- Metrics include \`latency_ms\`, \`active_connections\`, \`max_connections\`, \`active_connections_pct\`, and \`database_size_bytes\`.`,

  redis: `# Redis in Gateway

## Explorer
- Keys are discovered with \`SCAN\`, not \`KEYS\`, so the browser can safely handle large keyspaces.
- Visual editing supports string, hash, list, set, and zset.
- Streams are browse-only in the visual explorer; use the command console for advanced stream operations.

## Command Console
- One or more Redis commands can be executed per request.
- Read, write, and admin commands are permission-gated by \`databases:query:read\`, \`databases:query:write\`, and \`databases:query:admin\`.

## Monitoring
- Health is based on connectivity and latency.
- Metrics include \`latency_ms\`, \`used_memory_bytes\`, \`maxmemory_bytes\`, \`memory_pct\`, \`connected_clients\`, and \`instantaneous_ops_per_sec\`.`,

  api: `# Gateway REST API

Gateway provides a full REST API for programmatic access to all features. API tokens allow external scripts, CI/CD pipelines, and integrations to interact with Gateway without a browser session.

## Creating an API Token
1. Go to **Settings** page → **API Tokens** section
2. Click **Create Token** → enter a name and select the scopes (permissions) the token should have
3. Token scopes must be a subset of your own group's scopes — you cannot grant permissions you don't have
4. The token is shown **once** after creation (prefixed with \`gw_\`) — copy and store it securely
5. Tokens cannot be retrieved after creation — if lost, revoke and create a new one

## Authentication
All API requests require authentication via the \`Authorization\` header:

\`\`\`bash
curl -H "Authorization: Bearer gw_your_token_here" https://gateway.example.com/api/cas
\`\`\`

Token format: \`gw_\` followed by 64 hex characters.

## Base URL
All endpoints are under \`/api/\`. Example: \`https://gateway.example.com/api/cas\`

## Key Endpoints

### PKI & Certificates
- \`GET /api/cas\` — list certificate authorities
- \`GET /api/cas/:id\` — get CA details
- \`POST /api/cas\` — create root CA
- \`POST /api/cas/:id/intermediate\` — create intermediate CA
- \`GET /api/certificates\` — list certificates
- \`POST /api/certificates/issue\` — issue a certificate
- \`POST /api/certificates/:id/revoke\` — revoke a certificate
- \`GET /api/certificates/:id/export\` — download cert + key
- \`GET /api/templates\` — list certificate templates

### SSL Certificates
- \`GET /api/ssl-certificates\` — list SSL certificates
- \`POST /api/ssl-certificates/acme\` — request ACME (Let's Encrypt) certificate
- \`POST /api/ssl-certificates/upload\` — upload custom certificate
- \`POST /api/ssl-certificates/internal\` — link PKI cert as SSL

### Reverse Proxy
- \`GET /api/proxy-hosts\` — list proxy hosts
- \`POST /api/proxy-hosts\` — create proxy host
- \`PATCH /api/proxy-hosts/:id\` — update proxy host
- \`DELETE /api/proxy-hosts/:id\` — delete proxy host
- \`GET /api/nginx-templates\` — list nginx config templates

### Domains
- \`GET /api/domains\` — list domains
- \`POST /api/domains\` — register domain
- \`POST /api/domains/:id/check-dns\` — trigger DNS re-check

### Nodes
- \`GET /api/nodes\` — list daemon nodes
- \`POST /api/nodes\` — create node (returns enrollment token)
- \`DELETE /api/nodes/:id\` — delete node

### Docker
- \`GET /api/docker/nodes/:nodeId/containers\` — list containers
- \`POST /api/docker/nodes/:nodeId/containers/:id/start\` — start container
- \`POST /api/docker/nodes/:nodeId/containers/:id/stop\` — stop container
- \`POST /api/docker/nodes/:nodeId/containers/:id/restart\` — restart container
- \`POST /api/docker/nodes/:nodeId/containers/:id/recreate\` — recreate with new config (supports \`image\` field for tag change)
- \`POST /api/docker/nodes/:nodeId/images/pull-sync\` — pull image synchronously (validates image exists)

### Docker Webhooks
- \`GET /api/docker/nodes/:nodeId/containers/:name/webhook\` — get webhook config
- \`PUT /api/docker/nodes/:nodeId/containers/:name/webhook\` — enable/update webhook
- \`DELETE /api/docker/nodes/:nodeId/containers/:name/webhook\` — disable webhook
- \`POST /api/webhooks/docker/:token\` — trigger webhook update (no auth header needed, token is in URL)

### Access Lists
- \`GET /api/access-lists\` — list access lists
- \`POST /api/access-lists\` — create access list

### Administration
- \`GET /api/admin/users\` — list users (requires admin:users scope)
- \`GET /api/admin/groups\` — list permission groups
- \`GET /api/audit\` — query audit log
- \`GET /api/tokens\` — list your API tokens
- \`POST /api/tokens\` — create new API token
- \`DELETE /api/tokens/:id\` — revoke a token

## Response Format
- Success: JSON body with the resource data
- Errors: \`{ "code": "ERROR_CODE", "message": "Human-readable description" }\`
- List endpoints return: \`{ "data": [...], "total": N, "page": 1, "totalPages": N }\`

## Rate Limits & Pagination
- Default page size: 20 items. Use \`?page=N&limit=N\` for pagination (max 100).
- Search: \`?search=term\` on list endpoints for text filtering.
- Filter by type: \`?type=nginx\` on nodes, \`?status=running\` on containers.

## Scopes
Token permissions are controlled by scopes. Each endpoint requires specific scopes. A token with only \`pki:cert:list\` can list certificates but cannot issue or revoke them. See the permissions topic for the full scope list.

## Token Management
- Tokens are tied to the user who created them
- Revoking a token invalidates it immediately
- Token last-used timestamp is tracked for auditing
- Tokens inherit the user's resource restrictions (if the user's group restricts a scope to specific resources, the token is similarly restricted)`,

  notifications: `# Webhook Notifications

## Overview
The notification system sends HTTP webhook notifications when alert conditions are met. It supports threshold-based alerts (CPU, memory, disk) and event-based alerts (node offline, container stopped, etc.).

## Alert Rules
Each alert rule defines:
- **Category**: node, container, proxy, or certificate
- **Type**: threshold (metric breaches a value) or event (something happens)
- **Threshold fields** (for threshold type): metric, metricTarget (optional sub-target such as a specific node disk mount), operator (>, >=, <, <=), thresholdValue, durationSeconds (fire observation window), fireThresholdPercent (percent of probes in that window that must breach), resolveAfterSeconds (resolve observation window, default 60s), resolveThresholdPercent (percent of probes in that window that must be clear)
- **Event fields** (for event type): eventPattern (offline, stopped, oom_killed, etc.)
- **Scope**: resourceIds — specific nodes/containers/certs to monitor (empty = all)
- **Severity**: info, warning, critical
- **Webhooks**: webhookIds — which webhooks receive notifications from this rule
- **Message template**: Handlebars template rendered with event-specific variables
- **Cooldown**: cooldownSeconds — won't re-fire within this period (default 900s = 15 min)

## Webhooks
Webhooks define where notifications are delivered:
- URL, HTTP method (POST/PUT/PATCH/GET)
- Body template (Handlebars) with preset options: Discord, Slack, Telegram, Generic JSON, Plain Text
- Custom headers (key-value pairs)
- HMAC-SHA256 signing with configurable secret and header name
- Delivery log with retry (5 attempts, exponential backoff)

## Handlebars Template Variables
Available in message templates (per-alert) and body templates (per-webhook):

### Common variables (all alerts)
- \`{{alert_name}}\` — alert rule name
- \`{{severity}}\` — alert severity (info/warning/critical)
- \`{{severity_emoji}}\` — emoji for severity
- \`{{resource.name}}\` — resource display name
- \`{{resource.id}}\` — resource ID
- \`{{resource.type}}\` — resource type (node/container/proxy/certificate)
- \`{{timestamp}}\` — ISO 8601 timestamp
- \`{{fired_at}}\` — when alert started firing
- \`{{fired_duration}}\` — seconds the alert was firing (on resolve)

### Threshold-specific variables
- \`{{value}}\` — current metric value
- \`{{threshold}}\` — configured threshold
- \`{{operator}}\` — comparison operator
- \`{{metric}}\` — metric name (cpu, memory, disk)
- \`{{duration}}\` — configured fire-after duration (e.g. "5m")
- \`{{node_name}}\` / \`{{hostname}}\` — node hostname

### Category-specific variables
- Container: \`{{node_name}}\` — hosting node
- Proxy: \`{{health_status}}\` — health status
- Certificate: \`{{days_until_expiry}}\`, \`{{expiry_date}}\`

## Handlebars Helpers
Available in all templates:

### Comparison & logic
\`{{#if (gt value 90)}}CRITICAL{{else}}OK{{/if}}\`, \`eq\`, \`ne\`, \`gt\`, \`lt\`, \`gte\`, \`lte\`, \`and\`, \`or\`, \`not\`

### Formatting
- \`{{round value 1}}\` — round to N decimals (e.g. 11.237 → 11.2)
- \`{{uppercase str}}\`, \`{{lowercase str}}\`
- \`{{truncate str 50}}\` — truncate with ellipsis
- \`{{json obj}}\` — JSON.stringify
- \`{{default value "N/A"}}\` — fallback for null/undefined
- \`{{join array ", "}}\` — join array elements

### Math & calculations
- \`{{math value "+" 10}}\` — arithmetic (+, -, *, /, %)
- \`{{percent used total}}\` — calculate percentage
- \`{{round (math value "/" 1024) 2}}\` — combine helpers

### Time & dates
- \`{{formatDuration seconds}}\` — human format: "5m 30s", "2h 15m"
- \`{{timeago timestamp}}\` — relative: "3 minutes ago"
- \`{{dateformat timestamp "YYYY-MM-DD HH:mm"}}\` — custom format
- Format tokens: YYYY, MM, DD, HH, mm, ss

### Text
- \`{{pluralize count "container" "containers"}}\` — singular/plural

## Template Examples
- \`CPU at {{round value 1}}% on {{resource.name}} (threshold: {{operator}} {{threshold}}%)\`
- \`{{resource.name}} {{metric}} has been above {{threshold}}% for {{duration}}\`
- \`Resolved after {{formatDuration fired_duration}} — {{metric}} now at {{round value 1}}%\`
- \`{{#if (gt value 95)}}🔥 CRITICAL{{else}}⚠️ Warning{{/if}}: {{alert_name}}\`

## API Endpoints
- \`GET /api/notifications/alert-rules\` — list rules (notifications:view)
- \`POST /api/notifications/alert-rules\` — create rule (notifications:manage)
- \`PUT /api/notifications/alert-rules/:id\` — update rule (notifications:manage)
- \`DELETE /api/notifications/alert-rules/:id\` — delete rule (notifications:manage)
- \`GET /api/notifications/alert-rules/categories\` — list categories with metrics/events/variables
- \`GET /api/notifications/webhooks\` — list webhooks (notifications:view)
- \`POST /api/notifications/webhooks\` — create webhook (notifications:manage)
- \`PUT /api/notifications/webhooks/:id\` — update webhook (notifications:manage)
- \`DELETE /api/notifications/webhooks/:id\` — delete webhook (notifications:manage)
- \`POST /api/notifications/webhooks/:id/test\` — send test delivery
- \`GET /api/notifications/deliveries\` — list delivery log (notifications:view)
- \`GET /api/notifications/deliveries/stats\` — delivery statistics`,
};

/** Map doc topics to the scope required to read them */
export const DOC_TOPIC_SCOPES: Record<string, string> = {
  pki: 'pki:ca:list:root',
  ssl: 'ssl:cert:list',
  proxy: 'proxy:list',
  domains: 'proxy:list',
  'access-lists': 'acl:list',
  templates: 'pki:templates:list',
  acme: 'ssl:cert:list',
  users: 'admin:users',
  audit: 'admin:audit',
  nginx: 'proxy:edit',
  nodes: 'nodes:list',
  docker: 'docker:containers:list',
  databases: 'databases:list',
  postgres: 'databases:view',
  redis: 'databases:view',
  housekeeping: 'admin:housekeeping',
  permissions: 'feat:ai:use',
  api: 'feat:ai:use',
  notifications: 'notifications:view',
};

export function getInternalDocumentation(topic: string, userScopes: string[]): { topic: string; content: string } {
  const content = INTERNAL_DOCS[topic];
  if (!content) {
    // Only list topics the user has access to
    const available = Object.keys(INTERNAL_DOCS).filter(
      (t) => !DOC_TOPIC_SCOPES[t] || hasScope(userScopes, DOC_TOPIC_SCOPES[t])
    );
    return {
      topic,
      content: `Unknown topic "${topic}". Available topics: ${available.join(', ')}.`,
    };
  }
  const requiredScope = DOC_TOPIC_SCOPES[topic];
  if (requiredScope && !hasScope(userScopes, requiredScope)) {
    return { topic, content: `You do not have permission to access documentation for "${topic}".` };
  }
  return { topic, content };
}
