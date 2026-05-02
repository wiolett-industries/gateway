import { describe, expect, it } from 'vitest';
import type { Env } from '@/config/env.js';
import type { DrizzleClient } from '@/db/client.js';
import { DaemonUpdateService } from './daemon-update.service.js';

describe('DaemonUpdateService update artifact URLs', () => {
  it('normalizes a trailing GitLab API slash before building signed artifact URLs', () => {
    const service = new DaemonUpdateService(
      {} as DrizzleClient,
      {
        GITLAB_API_URL: 'https://gitlab.wiolett.net/',
        GITLAB_PROJECT_PATH: 'wiolett/gateway',
      } as Env
    );

    expect(service.getDownloadUrl('nginx', 'v9.9.9-nginx', 'amd64')).toBe(
      'https://gitlab.wiolett.net/api/v4/projects/wiolett%2Fgateway/packages/generic/nginx-daemon/v9.9.9-nginx/nginx-daemon-linux-amd64'
    );
    expect(service.getManifestUrl('nginx', 'v9.9.9-nginx', 'amd64')).toBe(
      'https://gitlab.wiolett.net/api/v4/projects/wiolett%2Fgateway/packages/generic/nginx-daemon/v9.9.9-nginx/nginx-daemon-linux-amd64.update.json'
    );
  });
});
