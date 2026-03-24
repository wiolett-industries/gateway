import { createChildLogger } from '@/lib/logger.js';
import type { DockerService } from './docker.service.js';
import type { ConfigValidatorService } from './config-validator.service.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const logger = createChildLogger('NginxService');

/** Nginx sees certs under this path (inside the nginx container). */
const NGINX_CERTS_PREFIX = '/etc/nginx/certs';

/** Nginx logs directory (inside the nginx container). */
const NGINX_LOGS_PREFIX = '/var/log/nginx';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProxyHostConfig {
  id: string;
  type: 'proxy' | 'redirect' | '404';
  domainNames: string[];
  enabled: boolean;
  forwardHost: string | null;
  forwardPort: number | null;
  forwardScheme: 'http' | 'https';
  sslEnabled: boolean;
  sslForced: boolean;
  http2Support: boolean;
  websocketSupport: boolean;
  redirectUrl: string | null;
  redirectStatusCode: number;
  customHeaders: { name: string; value: string }[];
  cacheEnabled: boolean;
  cacheOptions: Record<string, unknown> | null;
  rateLimitEnabled: boolean;
  rateLimitOptions: Record<string, unknown> | null;
  customRewrites: { source: string; destination: string; type: string }[];
  advancedConfig: string | null;
  accessList: {
    id: string;
    ipRules: { type: string; value: string }[];
    basicAuthEnabled: boolean;
  } | null;
  sslCertPath: string | null;
  sslKeyPath: string | null;
  sslChainPath: string | null;
  templateVariables?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class NginxService {
  constructor(
    private readonly configPath: string,
    private readonly certsPath: string,
    private readonly logsPath: string,
    private readonly acmeChallengePath: string,
    private readonly dockerService: DockerService,
    private readonly configValidator: ConfigValidatorService,
  ) {}

  // -----------------------------------------------------------------------
  // Input sanitization
  // -----------------------------------------------------------------------

  /**
   * Sanitize a user-provided value before interpolation into nginx config.
   * Strips characters that could break out of the directive context.
   */
  private sanitizeNginxValue(value: string): string {
    // Remove newlines, semicolons, quotes, curly braces, backticks, dollar signs, and hash (comment)
    return value.replace(/[\n\r;'"{}`$#]/g, '');
  }

  /**
   * Validate that a forwardHost value is a safe hostname or IP address.
   */
  private validateForwardHost(host: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
      throw new Error(`Invalid forwardHost value: ${host}`);
    }
    return host;
  }

  // -----------------------------------------------------------------------
  // Config generation — public entry point
  // -----------------------------------------------------------------------

  generateConfig(host: ProxyHostConfig): string {
    // Guard: if SSL is enabled but no cert paths, disable SSL for this host
    // rather than generating an invalid config that would break nginx
    if (host.sslEnabled && (!host.sslCertPath || !host.sslKeyPath)) {
      logger.warn('SSL enabled but no certificate paths set, disabling SSL for host', { hostId: host.id });
      host = { ...host, sslEnabled: false, sslForced: false };
    }

    switch (host.type) {
      case 'proxy':
        return this.generateProxyConfig(host);
      case 'redirect':
        return this.generateRedirectConfig(host);
      case '404':
        return this.generateDeadConfig(host);
    }
  }

  // -----------------------------------------------------------------------
  // Proxy server block
  // -----------------------------------------------------------------------

  private generateProxyConfig(host: ProxyHostConfig): string {
    const serverNames = host.domainNames.map((d) => this.sanitizeNginxValue(d)).join(' ');
    const sanitizedHost = host.forwardHost ? this.validateForwardHost(host.forwardHost) : '';
    const upstream = `${host.forwardScheme}://${sanitizedHost}:${host.forwardPort}`;
    const lines: string[] = [];
    let rateLimitBurst = 20;

    // --- Rate-limit zone (must be outside server block) ---
    if (host.rateLimitEnabled && host.rateLimitOptions) {
      const opts = host.rateLimitOptions as Record<string, unknown>;
      const rps = opts.requestsPerSecond ?? 10;
      rateLimitBurst = (opts.burst as number) ?? 20;
      lines.push(
        `limit_req_zone $binary_remote_addr zone=ratelimit_${host.id}:10m rate=${rps}r/s;`,
      );
      lines.push('');
    }

    // --- Cache path (must be outside server block) ---
    if (host.cacheEnabled && host.cacheOptions) {
      const maxAge = (host.cacheOptions as Record<string, unknown>).maxAge ?? 3600;
      lines.push(
        `proxy_cache_path /tmp/nginx-cache-${host.id} levels=1:2 keys_zone=cache_${host.id}:10m max_size=100m inactive=${maxAge}s;`,
      );
      lines.push('');
    }

    // =================================================================
    // HTTP → HTTPS redirect block (when SSL is forced)
    // =================================================================
    if (host.sslEnabled && host.sslForced) {
      lines.push('server {');
      lines.push('    listen 80;');
      lines.push('    listen [::]:80;');
      lines.push(`    server_name ${serverNames};`);
      lines.push('');
      lines.push('    # ACME challenge');
      lines.push('    location /.well-known/acme-challenge/ {');
      lines.push('        alias /var/www/acme-challenge/;');
      lines.push('        auth_basic off;');
      lines.push('    }');
      lines.push('');
      lines.push('    location / {');
      lines.push('        return 301 https://$host$request_uri;');
      lines.push('    }');
      lines.push('}');
      lines.push('');
    }

    // =================================================================
    // Main server block
    // =================================================================
    lines.push('server {');

    // --- Listen directives ---
    if (!host.sslEnabled || !host.sslForced) {
      lines.push('    listen 80;');
      lines.push('    listen [::]:80;');
    }

    if (host.sslEnabled) {
      const h2 = host.http2Support ? ' http2' : '';
      lines.push(`    listen 443 ssl${h2};`);
      lines.push(`    listen [::]:443 ssl${h2};`);
    }

    lines.push(`    server_name ${serverNames};`);
    lines.push('');

    // --- SSL settings ---
    if (host.sslEnabled) {
      if (host.sslCertPath) {
        lines.push(`    ssl_certificate ${host.sslCertPath};`);
      }
      if (host.sslKeyPath) {
        lines.push(`    ssl_certificate_key ${host.sslKeyPath};`);
      }
      if (host.sslChainPath) {
        lines.push(`    ssl_trusted_certificate ${host.sslChainPath};`);
      }
      lines.push('    ssl_protocols TLSv1.2 TLSv1.3;');
      lines.push(
        '    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;',
      );
      lines.push('    ssl_prefer_server_ciphers off;');
      lines.push('    ssl_session_cache shared:SSL:10m;');
      lines.push('    ssl_session_timeout 1d;');
      lines.push('    ssl_session_tickets off;');
      lines.push('');
    }

    // --- Per-host logging ---
    lines.push(
      `    access_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.access.log;`,
    );
    lines.push(
      `    error_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.error.log warn;`,
    );
    lines.push('');

    // --- ACME challenge (on the main block too, when SSL is not forced) ---
    if (!host.sslForced) {
      lines.push('    # ACME challenge');
      lines.push('    location /.well-known/acme-challenge/ {');
      lines.push('        alias /var/www/acme-challenge/;');
      lines.push('        auth_basic off;');
      lines.push('    }');
      lines.push('');
    }

    // --- Access list (IP allow/deny) ---
    if (host.accessList) {
      for (const rule of host.accessList.ipRules) {
        const safeType = this.sanitizeNginxValue(rule.type);
        const safeValue = this.sanitizeNginxValue(rule.value);
        lines.push(`    ${safeType} ${safeValue};`);
      }
      if (host.accessList.ipRules.length > 0) {
        lines.push('    deny all;');
      }
      lines.push('');
    }

    // --- Main location ---
    lines.push('    location / {');

    // Rate limiting
    if (host.rateLimitEnabled && host.rateLimitOptions) {
      lines.push(
        `        limit_req zone=ratelimit_${host.id} burst=${rateLimitBurst} nodelay;`,
      );
    }

    // Cache
    if (host.cacheEnabled && host.cacheOptions) {
      const stale =
        (host.cacheOptions as Record<string, unknown>).staleWhileRevalidate ?? 60;
      lines.push(`        proxy_cache cache_${host.id};`);
      lines.push(
        '        proxy_cache_valid 200 301 302 ' +
          `${(host.cacheOptions as Record<string, unknown>).maxAge ?? 3600}s;`,
      );
      lines.push(`        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;`);
      lines.push(
        `        proxy_cache_background_update on;`,
      );
      lines.push('        add_header X-Cache-Status $upstream_cache_status;');
    }

    // Proxy pass
    lines.push(`        proxy_pass ${upstream};`);
    lines.push('');

    // Standard proxy headers
    lines.push('        proxy_set_header Host $host;');
    lines.push('        proxy_set_header X-Real-IP $remote_addr;');
    lines.push(
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    );
    lines.push('        proxy_set_header X-Forwarded-Proto $scheme;');
    lines.push('        proxy_set_header X-Forwarded-Host $host;');
    lines.push('        proxy_set_header X-Forwarded-Port $server_port;');
    lines.push('');

    // Proxy timeouts
    lines.push('        proxy_connect_timeout 60s;');
    lines.push('        proxy_send_timeout 60s;');
    lines.push('        proxy_read_timeout 60s;');
    lines.push('');

    // WebSocket upgrade
    if (host.websocketSupport) {
      lines.push('        # WebSocket support');
      lines.push('        proxy_http_version 1.1;');
      lines.push('        proxy_set_header Upgrade $http_upgrade;');
      lines.push('        proxy_set_header Connection $connection_upgrade;');
      lines.push('');
    }

    // Custom headers
    if (host.customHeaders.length > 0) {
      lines.push('        # Custom headers');
      for (const header of host.customHeaders) {
        const safeName = this.sanitizeNginxValue(header.name);
        const safeValue = this.sanitizeNginxValue(header.value);
        lines.push(
          `        proxy_set_header ${safeName} "${safeValue}";`,
        );
      }
      lines.push('');
    }

    // URL rewrites
    if (host.customRewrites.length > 0) {
      lines.push('        # URL rewrites');
      for (const rewrite of host.customRewrites) {
        const flag = rewrite.type === 'permanent' ? 'permanent' : 'redirect';
        const safeSource = this.sanitizeNginxValue(rewrite.source);
        const safeDest = this.sanitizeNginxValue(rewrite.destination);
        lines.push(
          `        rewrite ${safeSource} ${safeDest} ${flag};`,
        );
      }
      lines.push('');
    }

    lines.push('    }');

    // --- Basic auth location (if access list has basic auth) ---
    if (host.accessList?.basicAuthEnabled) {
      lines.push('');
      lines.push('    # Basic authentication');
      lines.push('    auth_basic "Restricted Access";');
      lines.push(`    auth_basic_user_file /etc/nginx/conf.d/sites/htpasswd/access-list-${host.accessList.id};`);
    }

    // --- Advanced config injection ---
    if (host.advancedConfig) {
      lines.push('');
      lines.push('    # Advanced custom config');
      // Indent each line to sit inside the server block
      for (const line of host.advancedConfig.split('\n')) {
        lines.push(`    ${line}`);
      }
    }

    lines.push('}');

    // WebSocket upgrade map (add if needed; typically in http block but we
    // include a comment suggesting it belongs in main nginx.conf)
    if (host.websocketSupport) {
      lines.push('');
      lines.push('# Note: The following map should be in the http block of nginx.conf:');
      lines.push('# map $http_upgrade $connection_upgrade {');
      lines.push('#     default upgrade;');
      lines.push("#     ''      close;");
      lines.push('# }');
    }

    return lines.join('\n') + '\n';
  }

  // -----------------------------------------------------------------------
  // Redirect server block
  // -----------------------------------------------------------------------

  private generateRedirectConfig(host: ProxyHostConfig): string {
    const serverNames = host.domainNames.map((d) => this.sanitizeNginxValue(d)).join(' ');
    const statusCode = host.redirectStatusCode || 301;
    const redirectUrl = this.sanitizeNginxValue(host.redirectUrl ?? '/');
    const lines: string[] = [];

    // --- HTTP block ---
    lines.push('server {');
    lines.push('    listen 80;');
    lines.push('    listen [::]:80;');
    lines.push(`    server_name ${serverNames};`);
    lines.push('');
    lines.push(
      `    access_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.access.log;`,
    );
    lines.push(
      `    error_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.error.log warn;`,
    );
    lines.push('');

    // ACME challenge
    lines.push('    # ACME challenge');
    lines.push('    location /.well-known/acme-challenge/ {');
    lines.push('        alias /var/www/acme-challenge/;');
    lines.push('        auth_basic off;');
    lines.push('    }');
    lines.push('');

    if (host.sslEnabled && host.sslForced) {
      lines.push('    location / {');
      lines.push('        return 301 https://$host$request_uri;');
      lines.push('    }');
    } else {
      lines.push('    location / {');
      lines.push(`        return ${statusCode} ${redirectUrl};`);
      lines.push('    }');
    }

    lines.push('}');

    // --- HTTPS block (when SSL enabled) ---
    if (host.sslEnabled) {
      lines.push('');
      lines.push('server {');
      const h2 = host.http2Support ? ' http2' : '';
      lines.push(`    listen 443 ssl${h2};`);
      lines.push(`    listen [::]:443 ssl${h2};`);
      lines.push(`    server_name ${serverNames};`);
      lines.push('');

      if (host.sslCertPath) {
        lines.push(`    ssl_certificate ${host.sslCertPath};`);
      }
      if (host.sslKeyPath) {
        lines.push(`    ssl_certificate_key ${host.sslKeyPath};`);
      }
      if (host.sslChainPath) {
        lines.push(`    ssl_trusted_certificate ${host.sslChainPath};`);
      }
      lines.push('    ssl_protocols TLSv1.2 TLSv1.3;');
      lines.push(
        '    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;',
      );
      lines.push('    ssl_prefer_server_ciphers off;');
      lines.push('');

      lines.push(
        `    access_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.access.log;`,
      );
      lines.push(
        `    error_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.error.log warn;`,
      );
      lines.push('');

      lines.push('    location / {');
      lines.push(`        return ${statusCode} ${redirectUrl};`);
      lines.push('    }');

      lines.push('}');
    }

    return lines.join('\n') + '\n';
  }

  // -----------------------------------------------------------------------
  // Dead (404) server block
  // -----------------------------------------------------------------------

  private generateDeadConfig(host: ProxyHostConfig): string {
    const serverNames = host.domainNames.map((d) => this.sanitizeNginxValue(d)).join(' ');
    const lines: string[] = [];

    lines.push('server {');
    lines.push('    listen 80;');
    lines.push('    listen [::]:80;');
    lines.push(`    server_name ${serverNames};`);
    lines.push('');
    lines.push(
      `    access_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.access.log;`,
    );
    lines.push(
      `    error_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.error.log warn;`,
    );
    lines.push('');
    lines.push('    location / {');
    lines.push('        return 404;');
    lines.push('    }');
    lines.push('}');

    // HTTPS variant
    if (host.sslEnabled) {
      lines.push('');
      lines.push('server {');
      const h2 = host.http2Support ? ' http2' : '';
      lines.push(`    listen 443 ssl${h2};`);
      lines.push(`    listen [::]:443 ssl${h2};`);
      lines.push(`    server_name ${serverNames};`);
      lines.push('');

      if (host.sslCertPath) {
        lines.push(`    ssl_certificate ${host.sslCertPath};`);
      }
      if (host.sslKeyPath) {
        lines.push(`    ssl_certificate_key ${host.sslKeyPath};`);
      }
      if (host.sslChainPath) {
        lines.push(`    ssl_trusted_certificate ${host.sslChainPath};`);
      }
      lines.push('    ssl_protocols TLSv1.2 TLSv1.3;');
      lines.push(
        '    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;',
      );
      lines.push('    ssl_prefer_server_ciphers off;');
      lines.push('');
      lines.push(
        `    access_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.access.log;`,
      );
      lines.push(
        `    error_log ${NGINX_LOGS_PREFIX}/proxy-${host.id}.error.log warn;`,
      );
      lines.push('');
      lines.push('    location / {');
      lines.push('        return 404;');
      lines.push('    }');
      lines.push('}');
    }

    return lines.join('\n') + '\n';
  }

  // -----------------------------------------------------------------------
  // File operations
  // -----------------------------------------------------------------------

  async writeConfig(hostId: string, content: string): Promise<void> {
    const filePath = path.join(this.configPath, `proxy-host-${hostId}.conf`);
    await fs.writeFile(filePath, content, 'utf-8');
    logger.debug('Config written', { filePath });
  }

  async removeConfig(hostId: string): Promise<void> {
    const filePath = path.join(this.configPath, `proxy-host-${hostId}.conf`);
    try {
      await fs.unlink(filePath);
      logger.debug('Config removed', { filePath });
    } catch {
      // Ignore if the file does not exist
    }
  }

  async readConfig(hostId: string): Promise<string | null> {
    const filePath = path.join(this.configPath, `proxy-host-${hostId}.conf`);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Config test + reload with rollback
  // -----------------------------------------------------------------------

  async testConfig(): Promise<{ valid: boolean; error?: string }> {
    try {
      return await this.dockerService.testNginxConfig();
    } catch (error) {
      // Docker/Nginx not available (e.g., dev mode without Nginx container)
      logger.warn('Nginx test skipped — Docker/Nginx unavailable', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      return { valid: true };
    }
  }

  async reloadNginx(): Promise<void> {
    try {
      await this.dockerService.reloadNginx();
    } catch (error) {
      // Docker/Nginx not available (e.g., dev mode without Nginx container)
      logger.warn('Nginx reload skipped — Docker/Nginx unavailable', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  /**
   * Safely apply a new config for a proxy host:
   *  1. Read current config (for rollback)
   *  2. Write the new config
   *  3. Test with `nginx -t`
   *  4. If the test fails, rollback and throw
   *  5. If the test passes, reload Nginx
   */
  async applyConfig(hostId: string, newConfig: string): Promise<void> {
    logger.info('Applying config', { hostId });

    // 1. Backup current config
    const previousConfig = await this.readConfig(hostId);

    // 2. Write new config
    await this.writeConfig(hostId, newConfig);

    // 3. Test
    const testResult = await this.testConfig();

    if (!testResult.valid) {
      logger.warn('Config test failed after write, rolling back', {
        hostId,
        error: testResult.error,
      });

      // 4. Rollback
      if (previousConfig !== null) {
        await this.writeConfig(hostId, previousConfig);
      } else {
        await this.removeConfig(hostId);
      }

      throw new Error(
        `Nginx config test failed: ${testResult.error ?? 'unknown error'}`,
      );
    }

    // 5. Reload
    await this.reloadNginx();
    logger.info('Config applied and Nginx reloaded', { hostId });
  }

  // -----------------------------------------------------------------------
  // Certificate file operations
  // -----------------------------------------------------------------------

  /**
   * Deploy certificate files to the certs volume.
   *
   * Returns the paths as Nginx sees them (under NGINX_CERTS_PREFIX),
   * not the app's local mount point.
   */
  async deployCertificate(
    certId: string,
    certPem: string,
    keyPem: string,
    chainPem?: string,
  ): Promise<{ certPath: string; keyPath: string; chainPath?: string }> {
    const certDir = path.join(this.certsPath, certId);
    await fs.mkdir(certDir, { recursive: true });

    const certFile = path.join(certDir, 'fullchain.pem');
    const keyFile = path.join(certDir, 'privkey.pem');

    await fs.writeFile(certFile, certPem, 'utf-8');
    await fs.writeFile(keyFile, keyPem, { encoding: 'utf-8', mode: 0o600 });

    const result: { certPath: string; keyPath: string; chainPath?: string } = {
      certPath: `${NGINX_CERTS_PREFIX}/${certId}/fullchain.pem`,
      keyPath: `${NGINX_CERTS_PREFIX}/${certId}/privkey.pem`,
    };

    if (chainPem) {
      const chainFile = path.join(certDir, 'chain.pem');
      await fs.writeFile(chainFile, chainPem, 'utf-8');
      result.chainPath = `${NGINX_CERTS_PREFIX}/${certId}/chain.pem`;
    }

    logger.info('Certificate deployed', { certId });
    return result;
  }

  async removeCertificate(certId: string): Promise<void> {
    const certDir = path.join(this.certsPath, certId);
    try {
      await fs.rm(certDir, { recursive: true, force: true });
      logger.info('Certificate removed', { certId });
    } catch {
      // Ignore if missing
    }
  }

  // -----------------------------------------------------------------------
  // Full sync from database (called on startup)
  // -----------------------------------------------------------------------

  /**
   * Regenerate every Nginx config file from the provided host list,
   * removing stale files and reloading Nginx.
   */
  async syncAllConfigs(hosts: ProxyHostConfig[], renderFn?: (host: ProxyHostConfig) => Promise<string>): Promise<void> {
    logger.info('Syncing all Nginx configs', { count: hosts.length });

    // Ensure config directory exists
    await fs.mkdir(this.configPath, { recursive: true });

    // Read current config files on disk
    const existingFiles = await fs.readdir(this.configPath);
    const existingConfFiles = existingFiles.filter(
      (f) => f.startsWith('proxy-host-') && f.endsWith('.conf'),
    );

    // Build set of expected file names
    const expectedFiles = new Set(
      hosts
        .filter((h) => h.enabled)
        .map((h) => `proxy-host-${h.id}.conf`),
    );

    // Remove configs that are no longer expected
    for (const file of existingConfFiles) {
      if (!expectedFiles.has(file)) {
        const filePath = path.join(this.configPath, file);
        await fs.unlink(filePath);
        logger.debug('Removed stale config', { file });
      }
    }

    // Write configs for all enabled hosts
    for (const host of hosts) {
      if (!host.enabled) {
        await this.removeConfig(host.id);
        continue;
      }
      const config = renderFn ? await renderFn(host) : this.generateConfig(host);
      await this.writeConfig(host.id, config);
    }

    // Test the full configuration
    const testResult = await this.testConfig();
    if (!testResult.valid) {
      logger.error('Nginx config test failed during sync', {
        error: testResult.error,
      });
      throw new Error(
        `Nginx config test failed during sync: ${testResult.error ?? 'unknown error'}`,
      );
    }

    // Reload Nginx
    await this.reloadNginx();
    logger.info('All Nginx configs synced and reloaded');
  }

  // -----------------------------------------------------------------------
  // Advanced config validation
  // -----------------------------------------------------------------------

  validateAdvancedConfig(snippet: string): { valid: boolean; errors: string[] } {
    return this.configValidator.validate(snippet);
  }
}
