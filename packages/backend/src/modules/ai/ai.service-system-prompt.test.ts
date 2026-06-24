import { describe, expect, it, vi } from 'vitest';
import { AIService } from './ai.service.js';

const BASE_USER = {
  id: 'user-1',
  oidcSubject: 'oidc-user',
  email: 'admin@example.com',
  name: 'Admin',
  avatarUrl: null,
  groupId: 'group-1',
  groupName: 'admin',
  scopes: [] as string[],
  isBlocked: false,
};

function createService({
  config = {},
  caService = {},
  monitoringService = {},
}: {
  config?: Record<string, unknown>;
  caService?: Record<string, unknown>;
  monitoringService?: Record<string, unknown>;
}) {
  return new AIService(
    { getConfig: vi.fn().mockResolvedValue(config) } as never,
    caService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { log: vi.fn() } as never,
    monitoringService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
}

describe('AIService system prompt', () => {
  it('includes scoped inventory, CA summaries, page context, and organization instructions', async () => {
    const caService = {
      getCATree: vi.fn().mockResolvedValue([
        { id: 'root-1', commonName: 'Root CA', type: 'root', status: 'active' },
        { id: 'intermediate-1', commonName: 'Intermediate CA', type: 'intermediate', status: 'active' },
      ]),
    };
    const monitoringService = {
      getDashboardStats: vi.fn().mockResolvedValue({
        cas: { total: 2, active: 2 },
        pkiCertificates: { total: 5, active: 4, revoked: 1, expired: 0 },
        proxyHosts: { total: 7, enabled: 6, online: 5 },
        sslCertificates: { total: 3, active: 2, expiringSoon: 1 },
        nodes: { total: 4, online: 3, offline: 1, pending: 0 },
      }),
    };
    const service = createService({
      config: { customSystemPrompt: 'Always prefer concise runbooks.' },
      caService,
      monitoringService,
    });

    const prompt = await service.buildSystemPrompt(
      {
        ...BASE_USER,
        scopes: ['pki:ca:view:root', 'pki:cert:view', 'proxy:view', 'ssl:cert:view', 'nodes:details'],
      },
      {
        route: '/proxy/hosts/host-1?tab=settings',
        resourceType: 'proxy host',
        resourceId: 'host-1!',
      }
    );

    expect(prompt).toContain('User: Admin (admin). Date:');
    expect(prompt).toContain('- Certificate Authorities: 2 total (2 active)');
    expect(prompt).toContain('- PKI Certificates: 5 total (4 active, 1 revoked, 0 expired)');
    expect(prompt).toContain('- Proxy Hosts: 7 total (6 enabled, 5 online)');
    expect(prompt).toContain('- SSL Certificates: 3 total (2 active, 1 expiring soon)');
    expect(prompt).toContain('- Nodes: 4 total (3 online, 1 offline, 0 pending)');
    expect(prompt).toContain('  - Root CA (root, active, id: root-1)');
    expect(prompt).not.toContain('Intermediate CA');
    expect(prompt).toContain('The user is currently viewing: /proxy/hosts/host-1tabsettings');
    expect(prompt).toContain('Focused resource: proxyhost with ID host-1');
    expect(prompt).toContain('## Organization Instructions\nAlways prefer concise runbooks.');
    expect(prompt).toContain('Use find_resource FIRST');
  });

  it('advertises logging documentation to logging-scoped users', async () => {
    const monitoringService = {
      getDashboardStats: vi.fn().mockRejectedValue(new Error('stats unavailable')),
    };
    const service = createService({ monitoringService });

    const prompt = await service.buildSystemPrompt({
      ...BASE_USER,
      scopes: ['logs:schemas:view'],
    });

    expect(prompt).toContain('Available topics:');
    expect(prompt).toContain('logging');
    expect(prompt).toContain('Use find_resource FIRST');
  });

  it('warns Docker-scoped users to recover stale container IDs through resource search', async () => {
    const monitoringService = {
      getDashboardStats: vi.fn().mockRejectedValue(new Error('stats unavailable')),
    };
    const service = createService({ monitoringService });

    const prompt = await service.buildSystemPrompt({
      ...BASE_USER,
      scopes: ['docker:containers:view'],
    });

    expect(prompt).toContain('Docker container IDs are volatile');
    expect(prompt).toContain('If a Docker tool returns "No such container"');
    expect(prompt).toContain('find_resource');
  });

  it('continues without inventory or CA sections when optional context fetches are unavailable', async () => {
    const caService = {
      getCATree: vi.fn(),
    };
    const monitoringService = {
      getDashboardStats: vi.fn().mockRejectedValue(new Error('stats unavailable')),
    };
    const service = createService({ caService, monitoringService });

    const prompt = await service.buildSystemPrompt({
      ...BASE_USER,
      scopes: ['proxy:view'],
    });

    expect(prompt).toContain('Scopes: proxy:view.');
    expect(prompt).not.toContain('## System Inventory');
    expect(prompt).not.toContain('## Certificate Authorities');
    expect(caService.getCATree).not.toHaveBeenCalled();
  });
});
