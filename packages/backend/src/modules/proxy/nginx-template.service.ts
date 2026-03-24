import Handlebars from 'handlebars';
import { eq, count } from 'drizzle-orm';
import { nginxTemplates } from '@/db/schema/nginx-templates.js';
import { proxyHosts } from '@/db/schema/proxy-hosts.js';
import { AuditService } from '@/modules/audit/audit.service.js';
import { AppError } from '@/middleware/error-handler.js';
import { createChildLogger } from '@/lib/logger.js';
import type { DrizzleClient } from '@/db/client.js';
import type { ProxyHostConfig } from '@/services/nginx.service.js';
import type { CreateNginxTemplateInput, UpdateNginxTemplateInput } from './nginx-template.schemas.js';

const logger = createChildLogger('NginxTemplateService');

const NGINX_LOGS_PREFIX = '/var/log/nginx';

// ---------------------------------------------------------------------------
// Register Handlebars helpers
// ---------------------------------------------------------------------------

const DANGEROUS_CHARS = /[\n\r;'"{}`$#]/g;

Handlebars.registerHelper('sanitize', (value: unknown) => {
  if (typeof value !== 'string') return value;
  return new Handlebars.SafeString(value.replace(DANGEROUS_CHARS, ''));
});

Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

// ---------------------------------------------------------------------------
// Built-in template content
// ---------------------------------------------------------------------------

const BUILTIN_PROXY_TEMPLATE = `{{#if rateLimitEnabled}}
limit_req_zone $binary_remote_addr zone=ratelimit_{{id}}:10m rate={{rateLimitRPS}}r/s;

{{/if}}
{{#if cacheEnabled}}
proxy_cache_path /tmp/nginx-cache-{{id}} levels=1:2 keys_zone=cache_{{id}}:10m max_size=100m inactive={{cacheMaxAge}}s;

{{/if}}
{{#if sslForced}}
server {
    listen 80;
    listen [::]:80;
    server_name {{serverNames}};

    location /.well-known/acme-challenge/ {
        alias /var/www/acme-challenge/;
        auth_basic off;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

{{/if}}
server {
{{#unless sslForced}}
    listen 80;
    listen [::]:80;
{{/unless}}
{{#if sslEnabled}}
    listen 443 ssl{{#if http2Support}} http2{{/if}};
    listen [::]:443 ssl{{#if http2Support}} http2{{/if}};
{{/if}}
    server_name {{serverNames}};

{{#if sslEnabled}}
    ssl_certificate {{sslCertPath}};
    ssl_certificate_key {{sslKeyPath}};
{{#if sslChainPath}}
    ssl_trusted_certificate {{sslChainPath}};
{{/if}}
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

{{/if}}
    access_log {{logPath}}.access.log;
    error_log {{logPath}}.error.log warn;

{{#unless sslForced}}
    location /.well-known/acme-challenge/ {
        alias /var/www/acme-challenge/;
        auth_basic off;
    }

{{/unless}}
{{#if accessList}}
{{#each accessList.ipRules}}
    {{sanitize this.type}} {{sanitize this.value}};
{{/each}}
    deny all;

{{/if}}
    location / {
{{#if rateLimitEnabled}}
        limit_req zone=ratelimit_{{id}} burst={{rateLimitBurst}} nodelay;
{{/if}}
{{#if cacheEnabled}}
        proxy_cache cache_{{id}};
        proxy_cache_valid 200 301 302 {{cacheMaxAge}}s;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        proxy_cache_background_update on;
        add_header X-Cache-Status $upstream_cache_status;
{{/if}}
        proxy_pass {{upstream}};

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

{{#if websocketSupport}}
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

{{/if}}
{{#each customHeaders}}
        proxy_set_header {{sanitize this.name}} "{{sanitize this.value}}";
{{/each}}
{{#each customRewrites}}
        rewrite {{sanitize this.source}} {{sanitize this.destination}} {{#if (eq this.type "permanent")}}permanent{{else}}redirect{{/if}};
{{/each}}
    }

{{#if accessList.basicAuthEnabled}}
    auth_basic "Restricted Access";
    auth_basic_user_file /etc/nginx/conf.d/sites/htpasswd/access-list-{{accessList.id}};
{{/if}}
{{#if advancedConfig}}
    {{{advancedConfig}}}
{{/if}}
}
`;

const BUILTIN_REDIRECT_TEMPLATE = `server {
    listen 80;
    listen [::]:80;
    server_name {{serverNames}};

    access_log {{logPath}}.access.log;
    error_log {{logPath}}.error.log warn;

    location /.well-known/acme-challenge/ {
        alias /var/www/acme-challenge/;
        auth_basic off;
    }

{{#if sslForced}}
    location / {
        return 301 https://$host$request_uri;
    }
{{else}}
    location / {
        return {{redirectStatusCode}} {{sanitize redirectUrl}};
    }
{{/if}}
}
{{#if sslEnabled}}

server {
    listen 443 ssl{{#if http2Support}} http2{{/if}};
    listen [::]:443 ssl{{#if http2Support}} http2{{/if}};
    server_name {{serverNames}};

{{#if sslCertPath}}
    ssl_certificate {{sslCertPath}};
{{/if}}
{{#if sslKeyPath}}
    ssl_certificate_key {{sslKeyPath}};
{{/if}}
{{#if sslChainPath}}
    ssl_trusted_certificate {{sslChainPath}};
{{/if}}
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    access_log {{logPath}}.access.log;
    error_log {{logPath}}.error.log warn;

    location / {
        return {{redirectStatusCode}} {{sanitize redirectUrl}};
    }
}
{{/if}}
`;

const BUILTIN_DEAD_TEMPLATE = `server {
    listen 80;
    listen [::]:80;
    server_name {{serverNames}};

    access_log {{logPath}}.access.log;
    error_log {{logPath}}.error.log warn;

    location / {
        return 404;
    }
}
{{#if sslEnabled}}

server {
    listen 443 ssl{{#if http2Support}} http2{{/if}};
    listen [::]:443 ssl{{#if http2Support}} http2{{/if}};
    server_name {{serverNames}};

{{#if sslCertPath}}
    ssl_certificate {{sslCertPath}};
{{/if}}
{{#if sslKeyPath}}
    ssl_certificate_key {{sslKeyPath}};
{{/if}}
{{#if sslChainPath}}
    ssl_trusted_certificate {{sslChainPath}};
{{/if}}
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    access_log {{logPath}}.access.log;
    error_log {{logPath}}.error.log warn;

    location / {
        return 404;
    }
}
{{/if}}
`;

const BUILTIN_TEMPLATES = [
  { name: 'Default Proxy', description: 'Standard reverse proxy with SSL, caching, rate limiting, WebSocket, and access control support.', type: 'proxy' as const, content: BUILTIN_PROXY_TEMPLATE },
  { name: 'Default Redirect', description: 'HTTP redirect with optional SSL termination.', type: 'redirect' as const, content: BUILTIN_REDIRECT_TEMPLATE },
  { name: 'Default 404', description: 'Returns 404 for all requests. Use to block domains.', type: '404' as const, content: BUILTIN_DEAD_TEMPLATE },
];

// ---------------------------------------------------------------------------
// Sample context for preview
// ---------------------------------------------------------------------------

const SAMPLE_CONTEXT = {
  id: '00000000-0000-0000-0000-000000000000',
  serverNames: 'example.com www.example.com',
  upstream: 'http://10.0.0.1:8080',
  forwardScheme: 'http',
  forwardHost: '10.0.0.1',
  forwardPort: 8080,
  sslEnabled: true,
  sslForced: true,
  http2Support: true,
  websocketSupport: false,
  sslCertPath: '/etc/nginx/certs/example.com.crt',
  sslKeyPath: '/etc/nginx/certs/example.com.key',
  sslChainPath: null,
  redirectUrl: 'https://example.com',
  redirectStatusCode: 301,
  cacheEnabled: false,
  cacheMaxAge: 3600,
  cacheStale: 60,
  rateLimitEnabled: false,
  rateLimitRPS: 10,
  rateLimitBurst: 20,
  customHeaders: [],
  customRewrites: [],
  accessList: null,
  advancedConfig: null,
  logPath: '/var/log/nginx/proxy-00000000',
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class NginxTemplateService {
  constructor(
    private readonly db: DrizzleClient,
    private readonly auditService: AuditService,
  ) {}

  // -----------------------------------------------------------------------
  // Seed built-in templates
  // -----------------------------------------------------------------------

  async seedBuiltinTemplates(): Promise<void> {
    for (const template of BUILTIN_TEMPLATES) {
      const existing = await this.db.query.nginxTemplates.findFirst({
        where: (t, { and, eq }) => and(eq(t.name, template.name), eq(t.isBuiltin, true)),
      });
      if (!existing) {
        await this.db.insert(nginxTemplates).values({
          ...template,
          isBuiltin: true,
        });
        logger.info('Seeded built-in nginx template', { name: template.name });
      }
    }
  }

  // -----------------------------------------------------------------------
  // CRUD
  // -----------------------------------------------------------------------

  async listTemplates() {
    return this.db.query.nginxTemplates.findMany({
      orderBy: (t, { asc }) => [asc(t.name)],
    });
  }

  async getTemplate(id: string) {
    const template = await this.db.query.nginxTemplates.findFirst({
      where: eq(nginxTemplates.id, id),
    });
    if (!template) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Nginx template not found');
    return template;
  }

  async createTemplate(input: CreateNginxTemplateInput, userId: string) {
    // Validate the template compiles
    this.compileTemplate(input.content);

    const [template] = await this.db.insert(nginxTemplates).values({
      ...input,
      createdById: userId,
    }).returning();

    await this.auditService.log({
      userId,
      action: 'nginx_template.create',
      resourceType: 'nginx_template',
      resourceId: template.id,
      details: { name: template.name },
    });

    return template;
  }

  async updateTemplate(id: string, input: UpdateNginxTemplateInput, userId: string) {
    const existing = await this.getTemplate(id);
    if (existing.isBuiltin) throw new AppError(403, 'BUILTIN_IMMUTABLE', 'Built-in templates cannot be modified');

    if (input.content) {
      this.compileTemplate(input.content);
    }

    const [updated] = await this.db
      .update(nginxTemplates)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(nginxTemplates.id, id))
      .returning();

    await this.auditService.log({
      userId,
      action: 'nginx_template.update',
      resourceType: 'nginx_template',
      resourceId: id,
      details: { changes: Object.keys(input) },
    });

    return updated;
  }

  async deleteTemplate(id: string, userId: string) {
    const existing = await this.getTemplate(id);
    if (existing.isBuiltin) throw new AppError(403, 'BUILTIN_IMMUTABLE', 'Built-in templates cannot be deleted');

    // Check no proxy hosts using it
    const [{ count: usageCount }] = await this.db
      .select({ count: count() })
      .from(proxyHosts)
      .where(eq(proxyHosts.nginxTemplateId, id));

    if (Number(usageCount) > 0) {
      throw new AppError(400, 'TEMPLATE_IN_USE', `Template is used by ${usageCount} proxy host(s)`);
    }

    await this.db.delete(nginxTemplates).where(eq(nginxTemplates.id, id));

    await this.auditService.log({
      userId,
      action: 'nginx_template.delete',
      resourceType: 'nginx_template',
      resourceId: id,
      details: { name: existing.name },
    });
  }

  async cloneTemplate(id: string, userId: string) {
    const existing = await this.getTemplate(id);

    const [clone] = await this.db.insert(nginxTemplates).values({
      name: `Copy of ${existing.name}`,
      description: existing.description,
      type: existing.type,
      content: existing.content,
      variables: existing.variables ?? [],
      createdById: userId,
    }).returning();

    await this.auditService.log({
      userId,
      action: 'nginx_template.clone',
      resourceType: 'nginx_template',
      resourceId: clone.id,
      details: { sourceId: id, sourceName: existing.name },
    });

    return clone;
  }

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  renderTemplate(content: string, host: ProxyHostConfig): string {
    const template = this.compileTemplate(content);
    const context = this.buildContext(host);
    return template(context);
  }

  async getBuiltinTemplateContent(type: 'proxy' | 'redirect' | '404'): Promise<string> {
    const template = await this.db.query.nginxTemplates.findFirst({
      where: (t, { and, eq }) => and(eq(t.type, type), eq(t.isBuiltin, true)),
    });
    if (template) return template.content;

    // Fallback to hardcoded if DB not seeded yet
    switch (type) {
      case 'proxy': return BUILTIN_PROXY_TEMPLATE;
      case 'redirect': return BUILTIN_REDIRECT_TEMPLATE;
      case '404': return BUILTIN_DEAD_TEMPLATE;
    }
  }

  async renderForHost(host: ProxyHostConfig, templateId: string | null): Promise<string> {
    let content: string;
    if (templateId) {
      const template = await this.getTemplate(templateId);
      content = template.content;
    } else {
      content = await this.getBuiltinTemplateContent(host.type);
    }
    return this.renderTemplate(content, host);
  }

  previewWithSampleData(content: string): string {
    const template = this.compileTemplate(content);
    return template(SAMPLE_CONTEXT);
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private compileTemplate(content: string): HandlebarsTemplateDelegate {
    try {
      return Handlebars.compile(content, { noEscape: true });
    } catch (err) {
      throw new AppError(400, 'INVALID_TEMPLATE', `Template compilation error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  private buildContext(host: ProxyHostConfig): Record<string, unknown> {
    const serverNames = host.domainNames.map((d) => d.replace(DANGEROUS_CHARS, '')).join(' ');
    const sanitizedHost = host.forwardHost ? host.forwardHost.replace(DANGEROUS_CHARS, '') : '';
    const upstream = `${host.forwardScheme}://${sanitizedHost}:${host.forwardPort}`;

    const opts = (host.rateLimitOptions ?? {}) as Record<string, unknown>;
    const cacheOpts = (host.cacheOptions ?? {}) as Record<string, unknown>;

    return {
      id: host.id,
      serverNames,
      upstream,
      forwardScheme: host.forwardScheme,
      forwardHost: sanitizedHost,
      forwardPort: host.forwardPort,
      sslEnabled: host.sslEnabled,
      sslForced: host.sslForced,
      http2Support: host.http2Support,
      websocketSupport: host.websocketSupport,
      sslCertPath: host.sslCertPath,
      sslKeyPath: host.sslKeyPath,
      sslChainPath: host.sslChainPath,
      redirectUrl: host.redirectUrl,
      redirectStatusCode: host.redirectStatusCode,
      cacheEnabled: host.cacheEnabled,
      cacheMaxAge: cacheOpts.maxAge ?? 3600,
      cacheStale: cacheOpts.staleWhileRevalidate ?? 60,
      rateLimitEnabled: host.rateLimitEnabled,
      rateLimitRPS: opts.requestsPerSecond ?? 10,
      rateLimitBurst: opts.burst ?? 20,
      customHeaders: host.customHeaders,
      customRewrites: host.customRewrites,
      accessList: host.accessList,
      advancedConfig: host.advancedConfig,
      logPath: `${NGINX_LOGS_PREFIX}/proxy-${host.id}`,
      // Merge custom template variables (sanitized — user-defined values override defaults)
      ...this.sanitizeTemplateVariables(host.templateVariables ?? {}),
    };
  }

  private sanitizeTemplateVariables(vars: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
    const sanitized: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(vars)) {
      if (typeof value === 'string') {
        sanitized[key] = value.replace(DANGEROUS_CHARS, '');
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
}
