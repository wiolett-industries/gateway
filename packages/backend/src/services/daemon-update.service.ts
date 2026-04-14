import { eq } from 'drizzle-orm';
import type { Env } from '@/config/env.js';
import type { DrizzleClient } from '@/db/client.js';
import { nodes } from '@/db/schema/nodes.js';
import { settings } from '@/db/schema/settings.js';
import { createChildLogger } from '@/lib/logger.js';
import { compareSemver, isNewerVersion } from '@/lib/semver.js';

const logger = createChildLogger('DaemonUpdateService');

export type DaemonType = 'nginx' | 'docker' | 'monitoring';

const DAEMON_TYPES: DaemonType[] = ['nginx', 'docker', 'monitoring'];

const TAG_SUFFIX_MAP: Record<DaemonType, string> = {
  nginx: '-nginx',
  docker: '-docker',
  monitoring: '-monitoring',
};

const DAEMON_NAME_MAP: Record<DaemonType, string> = {
  nginx: 'nginx-daemon',
  docker: 'docker-daemon',
  monitoring: 'monitoring-daemon',
};

/** Maps node.type values to daemon types */
const NODE_TYPE_MAP: Record<string, DaemonType> = {
  nginx: 'nginx',
  docker: 'docker',
  monitoring: 'monitoring',
};

interface GitLabRelease {
  tag_name: string;
  description: string;
  _links: { self: string };
}

export interface DaemonRelease {
  daemonType: DaemonType;
  tagName: string;
  version: string;
  releaseNotes: string | null;
  releaseUrl: string | null;
}

export interface DaemonNodeUpdateStatus {
  nodeId: string;
  hostname: string;
  currentVersion: string;
  updateAvailable: boolean;
  arch?: string;
}

export interface DaemonUpdateStatus {
  daemonType: DaemonType;
  latestVersion: string | null;
  lastCheckedAt: string | null;
  nodes: DaemonNodeUpdateStatus[];
}

export class DaemonUpdateService {
  private readonly gitlabReleasesUrl: string;

  constructor(
    private readonly db: DrizzleClient,
    private readonly env: Env
  ) {
    const encodedPath = encodeURIComponent(this.env.GITLAB_PROJECT_PATH);
    this.gitlabReleasesUrl = `${this.env.GITLAB_API_URL}/api/v4/projects/${encodedPath}/releases`;
  }

  async checkForUpdates(): Promise<DaemonUpdateStatus[]> {
    const lastCheckedAt = new Date().toISOString();

    try {
      const response = await fetch(this.gitlabReleasesUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`GitLab API returned ${response.status}`);
      }

      const releases = (await response.json()) as GitLabRelease[];

      // Find latest release per daemon type
      for (const type of DAEMON_TYPES) {
        const suffix = TAG_SUFFIX_MAP[type];
        const matching = releases
          .filter((r) => r.tag_name.endsWith(suffix))
          .map((r) => ({
            ...r,
            version: r.tag_name.replace(suffix, ''),
          }))
          .sort((a, b) => compareSemver(b.version, a.version));

        const latest = matching[0];
        if (latest) {
          await this.upsertSetting(`daemon-update:${type}:latest_version`, latest.version);
          await this.upsertSetting(`daemon-update:${type}:latest_tag`, latest.tag_name);
          await this.upsertSetting(`daemon-update:${type}:release_notes`, latest.description || '');
        }
        await this.upsertSetting(`daemon-update:${type}:last_checked_at`, lastCheckedAt);
      }
    } catch (error) {
      logger.warn('Daemon update check failed', { error });
    }

    return this.getCachedStatus();
  }

  async getCachedStatus(): Promise<DaemonUpdateStatus[]> {
    const result: DaemonUpdateStatus[] = [];

    // Fetch all nodes
    const allNodes = await this.db.select().from(nodes);

    for (const type of DAEMON_TYPES) {
      const latestVersion = await this.getSetting(`daemon-update:${type}:latest_version`);
      const lastCheckedAt = await this.getSetting(`daemon-update:${type}:last_checked_at`);

      const typeNodes = allNodes
        .filter((n) => NODE_TYPE_MAP[n.type] === type)
        .map((n) => {
          const currentVersion = n.daemonVersion ?? 'unknown';
          const updateAvailable =
            latestVersion != null && currentVersion !== 'unknown' && currentVersion !== 'dev'
              ? isNewerVersion(latestVersion, currentVersion)
              : false;
          const caps = (n.capabilities ?? {}) as Record<string, unknown>;
          return {
            nodeId: n.id,
            hostname: n.displayName ?? n.hostname,
            currentVersion,
            updateAvailable,
            arch: (caps.architecture as string) ?? undefined,
          };
        });

      result.push({ daemonType: type, latestVersion, lastCheckedAt, nodes: typeNodes });
    }

    return result;
  }

  async getLatestRelease(daemonType: DaemonType): Promise<DaemonRelease | null> {
    const version = await this.getSetting(`daemon-update:${daemonType}:latest_version`);
    const tag = await this.getSetting(`daemon-update:${daemonType}:latest_tag`);
    const notes = await this.getSetting(`daemon-update:${daemonType}:release_notes`);
    if (!version || !tag) return null;
    return {
      daemonType,
      tagName: tag,
      version,
      releaseNotes: notes || null,
      releaseUrl: null,
    };
  }

  getDownloadUrl(daemonType: DaemonType, tag: string, arch: string): string {
    const daemonName = DAEMON_NAME_MAP[daemonType];
    const encodedPath = encodeURIComponent(this.env.GITLAB_PROJECT_PATH);
    return `${this.env.GITLAB_API_URL}/api/v4/projects/${encodedPath}/packages/generic/${daemonName}/${tag}/${daemonName}-linux-${arch}`;
  }

  getChecksumsUrl(daemonType: DaemonType, tag: string): string {
    const daemonName = DAEMON_NAME_MAP[daemonType];
    const encodedPath = encodeURIComponent(this.env.GITLAB_PROJECT_PATH);
    return `${this.env.GITLAB_API_URL}/api/v4/projects/${encodedPath}/packages/generic/${daemonName}/${tag}/checksums.txt`;
  }

  private async getSetting(key: string): Promise<string | null> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return (row?.value as string) ?? null;
  }

  private async upsertSetting(key: string, value: string): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}
