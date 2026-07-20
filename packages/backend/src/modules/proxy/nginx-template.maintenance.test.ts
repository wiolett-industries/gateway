import { describe, expect, it, vi } from 'vitest';
import { GATEWAY_MAINTENANCE_HTML, GATEWAY_NOT_FOUND_HTML } from '@/lib/gateway-error-pages.js';
import type { ProxyHostConfig } from '@/services/nginx-config-generator.service.js';
import { NginxTemplateService } from './nginx-template.service.js';

vi.mock('@/db/schema/proxy-hosts.js', () => ({ proxyHosts: { nginxTemplateId: 'nginx_template_id' } }));
vi.mock('@/db/schema/nginx-templates.js', () => ({
  nginxTemplates: { id: 'nginx_templates.id', type: 'nginx_templates.type', isBuiltin: 'nginx_templates.is_builtin' },
}));

const host: ProxyHostConfig = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'proxy',
  domainNames: ['example.com'],
  enabled: true,
  forwardHost: '10.0.0.2',
  forwardPort: 8080,
  forwardScheme: 'http',
  sslEnabled: true,
  sslForced: true,
  http2Support: true,
  websocketSupport: true,
  redirectUrl: null,
  redirectStatusCode: 301,
  customHeaders: [{ name: 'X-Test', value: 'yes' }],
  cacheEnabled: true,
  cacheOptions: { maxAge: 60 },
  rateLimitEnabled: true,
  rateLimitOptions: { requestsPerSecond: 10 },
  customRewrites: [{ source: '^/old', destination: '/new', type: 'permanent' }],
  advancedConfig: 'add_header X-Advanced yes;',
  accessList: { id: 'list-1', ipRules: [{ type: 'allow', value: '10.0.0.0/8' }], basicAuthEnabled: true },
  sslCertPath: '/etc/nginx/certs/example.crt',
  sslKeyPath: '/etc/nginx/certs/example.key',
  sslChainPath: '/etc/nginx/certs/example.chain.crt',
};

function service() {
  return new NginxTemplateService(
    { query: { nginxTemplates: { findFirst: async () => undefined } } } as any,
    {} as any
  );
}

describe('canonical Gateway nginx pages', () => {
  it('uses the shared minimal error-page layout without the Gateway header', () => {
    for (const page of [GATEWAY_NOT_FOUND_HTML, GATEWAY_MAINTENANCE_HTML]) {
      expect(page).toContain('Powered by <a href="https://wiolett.net"');
      expect(page).toContain('font-size:clamp(40px,8vw,64px)');
      expect(page).not.toContain('Self-hosted infrastructure control plane');
      expect(page).not.toContain('class="brand"');
      expect(page).not.toContain('class="card"');
    }
  });

  it('injects maintenance before location handling without rebuilding the TLS vhost', async () => {
    const templateService = service();
    const normalConfig = await templateService.renderForHost(host, null);
    const rendered = templateService.applyMaintenanceGuard(normalConfig);

    expect(rendered).toContain('listen 80;');
    expect(rendered).toContain('listen 443 ssl http2;');
    expect(rendered.match(/server \{/g)).toHaveLength(2);
    expect(rendered.match(/# Gateway maintenance mode/g)).toHaveLength(2);
    expect(rendered).toContain('ssl_session_timeout 1d;');
    expect(rendered).toContain('ssl_session_tickets off;');
    expect(rendered).toContain('ssl_certificate /etc/nginx/certs/example.crt;');
    expect(rendered).toContain('ssl_certificate_key /etc/nginx/certs/example.key;');
    expect(rendered).toContain('location /.well-known/acme-challenge/');
    expect(rendered).toContain('if ($uri !~ ^/\\.well-known/acme-challenge/)');
    expect(rendered).toContain('return 503');
    expect(rendered).toContain('Cache-Control "no-store" always');
    expect(rendered).toContain(GATEWAY_MAINTENANCE_HTML);
    expect(rendered).toContain('proxy_pass http://10.0.0.2:8080;');
    expect(rendered).toContain('X-Advanced');
    expect(rendered.indexOf('# Gateway maintenance mode')).toBeLessThan(rendered.indexOf('location /'));
  });

  it('preserves custom listen and certificate directives byte-for-byte', () => {
    const original = `server {
    listen 7443 ssl;
    ssl_certificate /custom/live/fullchain.pem;
    ssl_certificate_key /custom/live/privkey.pem;
    location / { proxy_pass https://upstream; }
}`;
    const rendered = service().applyMaintenanceGuard(original);

    expect(rendered).toContain('listen 7443 ssl;');
    expect(rendered).toContain('ssl_certificate /custom/live/fullchain.pem;');
    expect(rendered).toContain('ssl_certificate_key /custom/live/privkey.pem;');
  });

  it('rejects maintenance injection when a rendered config has no server block', () => {
    expect(() => service().applyMaintenanceGuard('upstream backend { server 10.0.0.2:8080; }')).toThrow(
      'Rendered proxy config has no server block'
    );
  });

  it('uses the canonical branded body for the built-in 404 template', async () => {
    const template = await service().getBuiltinTemplateContent('404');
    const rendered = service().renderTemplate(template, { ...host, type: '404' });
    expect(rendered).toContain('return 404');
    expect(rendered).toContain(GATEWAY_NOT_FOUND_HTML);
    expect(rendered).not.toContain('/usr/share/nginx/html');
  });
});
