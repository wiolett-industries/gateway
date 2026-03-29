import { inArray } from 'drizzle-orm';
import type { DrizzleClient } from '@/db/client.js';
import { settings } from '@/db/schema/settings.js';
import { createChildLogger } from '@/lib/logger.js';
import { isNewerVersion } from '@/lib/semver.js';
import type { Env } from '@/config/env.js';
import type { DockerService } from './docker.service.js';

const logger = createChildLogger('UpdateService');

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseNotes: string | null;
  releaseUrl: string | null;
  lastCheckedAt: string | null;
}

interface GitLabRelease {
  tag_name: string;
  description: string;
  _links: { self: string };
}

const SETTINGS_KEYS = {
  latestVersion: 'update:latest_version',
  lastCheckedAt: 'update:last_checked_at',
  releaseNotes: 'update:release_notes',
  releaseUrl: 'update:release_url',
} as const;

export class UpdateService {
  private readonly gitlabReleasesUrl: string;

  constructor(
    private readonly db: DrizzleClient,
    private readonly dockerService: DockerService,
    private readonly env: Env
  ) {
    const encodedPath = encodeURIComponent(this.env.GITLAB_PROJECT_PATH);
    this.gitlabReleasesUrl = `${this.env.GITLAB_API_URL}/api/v4/projects/${encodedPath}/releases`;
  }

  getCurrentVersion(): string {
    return this.env.APP_VERSION;
  }

  async getCachedStatus(): Promise<UpdateStatus> {
    const currentVersion = this.getCurrentVersion();

    const allRows = await this.db
      .select()
      .from(settings)
      .where(
        inArray(settings.key, Object.values(SETTINGS_KEYS))
      );

    const map = new Map(allRows.map((r) => [r.key, r.value as string]));

    const latestVersion = map.get(SETTINGS_KEYS.latestVersion) ?? null;
    const updateAvailable =
      currentVersion !== 'dev' && latestVersion != null
        ? isNewerVersion(latestVersion, currentVersion)
        : false;

    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseNotes: map.get(SETTINGS_KEYS.releaseNotes) ?? null,
      releaseUrl: map.get(SETTINGS_KEYS.releaseUrl) ?? null,
      lastCheckedAt: map.get(SETTINGS_KEYS.lastCheckedAt) ?? null,
    };
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    const currentVersion = this.getCurrentVersion();

    if (currentVersion === 'dev') {
      logger.debug('Skipping update check in dev mode');
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseNotes: null,
        releaseUrl: null,
        lastCheckedAt: new Date().toISOString(),
      };
    }

    try {
      logger.debug('Checking GitLab for updates', { url: this.gitlabReleasesUrl });

      const response = await fetch(this.gitlabReleasesUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`GitLab API returned ${response.status}`);
      }

      const releases = (await response.json()) as GitLabRelease[];

      if (!releases.length) {
        logger.debug('No releases found');
        return this.getCachedStatus();
      }

      const latest = releases[0];
      const latestVersion = latest.tag_name;
      const releaseNotes = latest.description || null;
      const releaseUrl = latest._links?.self || null;
      const lastCheckedAt = new Date().toISOString();

      // Persist to settings
      await this.upsertSetting(SETTINGS_KEYS.latestVersion, latestVersion);
      await this.upsertSetting(SETTINGS_KEYS.lastCheckedAt, lastCheckedAt);
      await this.upsertSetting(SETTINGS_KEYS.releaseNotes, releaseNotes ?? '');
      await this.upsertSetting(SETTINGS_KEYS.releaseUrl, releaseUrl ?? '');

      const updateAvailable = isNewerVersion(latestVersion, currentVersion);

      if (updateAvailable) {
        logger.info('Update available', { current: currentVersion, latest: latestVersion });
      } else {
        logger.debug('Already up to date', { current: currentVersion, latest: latestVersion });
      }

      return {
        currentVersion,
        latestVersion,
        updateAvailable,
        releaseNotes,
        releaseUrl,
        lastCheckedAt,
      };
    } catch (error) {
      logger.warn('Update check failed', { error });
      // Return cached status on failure
      return this.getCachedStatus();
    }
  }

  async getReleaseNotes(version: string): Promise<string> {
    const encodedPath = encodeURIComponent(this.env.GITLAB_PROJECT_PATH);
    const url = `${this.env.GITLAB_API_URL}/api/v4/projects/${encodedPath}/releases/${encodeURIComponent(version)}`;

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch release notes for ${version}: ${response.status}`);
    }

    const release = (await response.json()) as GitLabRelease;
    return release.description || '';
  }

  async performUpdate(targetVersion: string): Promise<void> {
    logger.info('Starting self-update', { targetVersion });

    // 1. Self-inspect to discover compose context
    const selfInfo = await this.dockerService.inspectSelf();
    const labels = selfInfo.Config.Labels;
    const composeDir = labels['com.docker.compose.project.working_dir'];

    const composeProject = labels['com.docker.compose.project'];

    if (!composeDir) {
      throw new Error('Cannot determine compose project directory from container labels');
    }
    if (!composeProject) {
      throw new Error('Cannot determine compose project name from container labels');
    }

    // Determine the image to pull from the current container's image name
    const currentImage = selfInfo.Config.Image;
    // The image might be "registry.gitlab.wiolett.net/wiolett/gateway:v1.0.0" or similar
    // Extract the base image (without tag)
    const imageBase = currentImage.includes(':')
      ? currentImage.substring(0, currentImage.lastIndexOf(':'))
      : currentImage;

    logger.info('Update context', { composeDir, composeProject, imageBase, targetVersion });

    // 2. Pull the new gateway image
    const tag = targetVersion.startsWith('v') ? targetVersion : `v${targetVersion}`;
    await this.dockerService.pullImage(imageBase, tag);

    // 3. Pull docker:27-cli for the sidecar (may already be cached)
    try {
      await this.dockerService.pullImage('docker', '27-cli');
    } catch (error) {
      logger.warn('Failed to pull docker:27-cli, trying with existing cache', { error });
    }

    // 4. Update .env on host via one-shot sidecar
    const envTag = tag; // Use the full tag with 'v' prefix
    logger.info('Updating .env on host', { composeDir, envTag });
    const envResult = await this.dockerService.runOneShot({
      Image: currentImage, // Use current image (guaranteed available)
      Cmd: [
        'sh', '-c',
        `sed -i 's/^GATEWAY_VERSION=.*/GATEWAY_VERSION=${envTag}/' /host/.env`,
      ],
      HostConfig: {
        Binds: [`${composeDir}:/host`],
      },
    });

    if (envResult.exitCode !== 0) {
      throw new Error(`Failed to update .env: ${envResult.output}`);
    }

    logger.info('.env updated, launching compose sidecar');

    // 5. Trigger docker compose up -d app via detached sidecar
    await this.dockerService.runDetached({
      Image: 'docker:27-cli',
      Cmd: [
        'sh', '-c',
        `sleep 2 && docker compose --project-name ${composeProject} -f /project/docker-compose.yml up -d app`,
      ],
      HostConfig: {
        Binds: [
          `${composeDir}:/project`,
          '/var/run/docker.sock:/var/run/docker.sock',
        ],
      },
    });

    logger.info('Update sidecar launched — container will be replaced shortly');
  }

  private async upsertSetting(key: string, value: unknown): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date() },
      });
  }
}
