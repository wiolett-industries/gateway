import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { patchCompose, patchEnv, runFoundationMigrations } from './foundation-migrator.js';

const OLD_COMPOSE = `services:
  app:
    image: \${GATEWAY_IMAGE}:\${GATEWAY_VERSION}
    restart: unless-stopped
    env_file: .env
    mem_limit: 1g
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./docker-compose.yml:/app/docker-compose.yml:ro
    depends_on:
      redis:
        condition: service_healthy

  redis:
    image: redis:7-alpine
`;
const DOLLAR = '$';
const EXPECTED_IMAGE_LINE = `image: ${DOLLAR}{GATEWAY_IMAGE_REF}`;
const EXPECTED_SANDBOX_VOLUME =
  `      - ${DOLLAR}{SANDBOX_RUNNER_WORKSPACE_DIR:-/var/lib/gateway/sandbox-workspaces}:` +
  `${DOLLAR}{SANDBOX_RUNNER_WORKSPACE_DIR:-/var/lib/gateway/sandbox-workspaces}`;

describe('foundation migrator patches', () => {
  it('adds the managed sandbox volume and normalizes the app image reference', () => {
    const patched = patchCompose(OLD_COMPOSE);

    expect(patched).toContain(EXPECTED_IMAGE_LINE);
    expect(patched).toContain('      # gateway-managed:start sandbox-workspace');
    expect(patched).toContain(EXPECTED_SANDBOX_VOLUME);
    expect(patched).toContain('      # gateway-managed:end sandbox-workspace');
    expect(patchCompose(patched)).toBe(patched);
  });

  it('replaces an existing unmarked sandbox volume instead of duplicating it', () => {
    const compose = OLD_COMPOSE.replace(
      '      - ./docker-compose.yml:/app/docker-compose.yml:ro',
      [
        '      - /var/lib/gateway/sandbox-workspaces:/var/lib/gateway/sandbox-workspaces',
        '      - ./docker-compose.yml:/app/docker-compose.yml:ro',
      ].join('\n')
    );
    const patched = patchCompose(compose);

    expect(patched.match(/sandbox-workspaces/g)).toHaveLength(2);
    expect(patched).toContain('# gateway-managed:start sandbox-workspace');
  });

  it('only patches the app service under services', () => {
    const compose = `app:
  image: unrelated/top-level:latest
  volumes:
    - ./top:/top

${OLD_COMPOSE}`;
    const patched = patchCompose(compose);

    expect(patched).toContain('app:\n  image: unrelated/top-level:latest');
    expect(patched).toContain(`    ${EXPECTED_IMAGE_LINE}`);
    expect(patched).toContain(EXPECTED_SANDBOX_VOLUME);
  });

  it('refuses malformed managed blocks', () => {
    const compose = OLD_COMPOSE.replace(
      '      - ./docker-compose.yml:/app/docker-compose.yml:ro',
      '      # gateway-managed:start sandbox-workspace\n      - ./docker-compose.yml:/app/docker-compose.yml:ro'
    );

    expect(() => patchCompose(compose)).toThrow('malformed sandbox workspace managed block');
  });

  it('upserts env keys without leaving duplicates', () => {
    const patched = patchEnv('GATEWAY_VERSION=v2.4.2\nGATEWAY_VERSION=old\nOTHER=value\n', {
      GATEWAY_VERSION: 'v2.4.3',
      GATEWAY_IMAGE_REF: 'registry/gateway:v2.4.3',
    }).content;

    expect(patched).toBe('GATEWAY_VERSION=v2.4.3\nOTHER=value\n\nGATEWAY_IMAGE_REF=registry/gateway:v2.4.3\n');
  });
});

describe('runFoundationMigrations', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = '';
  });

  it('patches host foundation files and writes backups only when files change', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'gateway-foundation-migrator-test-'));
    await writeFile(path.join(tempDir, '.env'), 'GATEWAY_VERSION=v2.4.2\n');
    await writeFile(path.join(tempDir, 'docker-compose.yml'), OLD_COMPOSE);
    const sandboxWorkspaceDir = path.join(tempDir, 'sandbox-workspaces');

    const first = await runFoundationMigrations({
      hostDir: tempDir,
      targetVersion: 'v2.4.3',
      imageRef: 'registry/gateway:v2.4.3',
      sandboxWorkspaceDir,
    });
    const second = await runFoundationMigrations({
      hostDir: tempDir,
      targetVersion: 'v2.4.3',
      imageRef: 'registry/gateway:v2.4.3',
      sandboxWorkspaceDir,
    });

    expect(first.changedFiles).toEqual(['.env', 'docker-compose.yml']);
    expect(first.backupDir).toContain('.gateway-foundation-backups');
    expect(second.changedFiles).toEqual([]);
    expect(second.backupDir).toBeNull();
    expect(await readFile(path.join(tempDir, '.env'), 'utf8')).toContain('GATEWAY_IMAGE_REF=registry/gateway:v2.4.3');
    expect(await readFile(path.join(tempDir, 'docker-compose.yml'), 'utf8')).toContain(
      '# gateway-managed:start sandbox-workspace'
    );
  });
});
