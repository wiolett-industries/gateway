import { inArray } from 'drizzle-orm';
import type { Env } from '@/config/env.js';
import type { DrizzleClient } from '@/db/client.js';
import { settings } from '@/db/schema/settings.js';
import { createChildLogger } from '@/lib/logger.js';
import { compareSemver, isNewerVersion, parseSemver } from '@/lib/semver.js';
import {
  normalizeGitLabApiUrl,
  type TrustedGatewayUpdateArtifact,
  verifyGatewayImageManifest,
} from '@/lib/update-artifact-trust.js';
import { AppError } from '@/middleware/error-handler.js';
import type { DockerService } from './docker.service.js';

const logger = createChildLogger('UpdateService');
const DOCKER_COMPOSE_CLI_IMAGE_REF =
  'docker.io/library/docker:27-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c';

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

export function isGatewayReleaseTag(tag: string): boolean {
  return /^v?\d+\.\d+\.\d+$/.test(tag);
}

export function selectLatestGatewayRelease(releases: GitLabRelease[]): GitLabRelease | null {
  const matching = releases
    .filter((release) => isGatewayReleaseTag(release.tag_name))
    .sort((a, b) => compareSemver(b.tag_name, a.tag_name));

  return matching[0] ?? null;
}

const SETTINGS_KEYS = {
  latestVersion: 'update:latest_version',
  lastCheckedAt: 'update:last_checked_at',
  releaseNotes: 'update:release_notes',
  releaseUrl: 'update:release_url',
} as const;

export class UpdateService {
  private readonly gitlabReleasesUrl: string;
  private readonly encodedProjectPath: string;
  private readonly gitlabApiUrl: string;

  constructor(
    private readonly db: DrizzleClient,
    private readonly dockerService: DockerService,
    private readonly env: Env
  ) {
    this.gitlabApiUrl = normalizeGitLabApiUrl(this.env.GITLAB_API_URL);
    this.encodedProjectPath = encodeURIComponent(this.env.GITLAB_PROJECT_PATH);
    this.gitlabReleasesUrl = `${this.gitlabApiUrl}/api/v4/projects/${this.encodedProjectPath}/releases`;
  }

  getCurrentVersion(): string {
    return this.env.APP_VERSION;
  }

  async getCachedStatus(): Promise<UpdateStatus> {
    const currentVersion = this.getCurrentVersion();

    const allRows = await this.db
      .select()
      .from(settings)
      .where(inArray(settings.key, Object.values(SETTINGS_KEYS)));

    const map = new Map(allRows.map((r) => [r.key, r.value as string]));

    const latestVersion = map.get(SETTINGS_KEYS.latestVersion) ?? null;
    const updateAvailable =
      currentVersion !== 'dev' && latestVersion != null ? isNewerVersion(latestVersion, currentVersion) : false;

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

    // Always persist the check timestamp
    const lastCheckedAt = new Date().toISOString();
    await this.upsertSetting(SETTINGS_KEYS.lastCheckedAt, lastCheckedAt);

    if (currentVersion === 'dev') {
      logger.debug('Skipping update check in dev mode');
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseNotes: null,
        releaseUrl: null,
        lastCheckedAt,
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

      const latest = selectLatestGatewayRelease(releases);
      if (!latest) {
        logger.debug('No gateway releases found');
        return this.getCachedStatus();
      }

      const latestVersion = latest.tag_name;
      const releaseNotes = latest.description || null;
      const releaseUrl = latest._links?.self || null;

      // Persist release info to settings (lastCheckedAt already saved above)
      await this.upsertSetting(SETTINGS_KEYS.latestVersion, latestVersion);
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
    const url = `${this.gitlabApiUrl}/api/v4/projects/${encodedPath}/releases/${encodeURIComponent(version)}`;

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

  /**
   * Fetch release notes for all versions between `after` (exclusive) and `upTo` (inclusive).
   * Returns newest first.
   */
  async getReleaseNotesSince(after: string, upTo: string): Promise<{ version: string; notes: string }[]> {
    const response = await fetch(this.gitlabReleasesUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`GitLab API returned ${response.status}`);
    }

    const releases = (await response.json()) as GitLabRelease[];

    // Filter releases: newer than `after` and up to `upTo` (inclusive)
    return releases
      .filter((r) => {
        const tag = r.tag_name;
        return isGatewayReleaseTag(tag) && compareSemver(tag, after) > 0 && compareSemver(tag, upTo) <= 0;
      })
      .sort((a, b) => compareSemver(b.tag_name, a.tag_name))
      .map((r) => ({ version: r.tag_name, notes: r.description || '' }));
  }

  async prepareGatewayUpdate(targetVersion: string): Promise<TrustedGatewayUpdateArtifact> {
    const tag = normalizeVersionTag(targetVersion);
    const selfInfo = await this.dockerService.inspectSelf();
    const imageBase = imageRepositoryFromRef(selfInfo.Config.Image);
    const manifestUrl = this.getGatewayManifestUrl(tag);

    const response = await fetch(manifestUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new AppError(
        502,
        'UNTRUSTED_UPDATE_ARTIFACT',
        `Failed to fetch gateway update manifest: ${response.status}`
      );
    }

    const signedManifest = await response.text();
    let artifact: TrustedGatewayUpdateArtifact;
    try {
      artifact = verifyGatewayImageManifest(signedManifest, {
        version: tag,
        tag,
        image: imageBase,
      });
    } catch (error) {
      logger.warn('Gateway update manifest verification failed', {
        targetVersion,
        imageBase,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError(502, 'UNTRUSTED_UPDATE_ARTIFACT', 'Gateway update artifact is not trusted');
    }

    return artifact;
  }

  async performUpdate(targetVersion: string, artifact: TrustedGatewayUpdateArtifact): Promise<void> {
    logger.info('Starting self-update', { targetVersion });

    const selfInfo = await this.dockerService.inspectSelf();
    const labels = selfInfo.Config.Labels;

    const composeDir = this.env.COMPOSE_PROJECT_DIR || labels['com.docker.compose.project.working_dir'];
    const composeProject = labels['com.docker.compose.project'];

    if (!composeDir) throw new Error('Cannot determine compose project directory');
    if (!/^\/[a-zA-Z0-9/_.-]+$/.test(composeDir)) throw new Error(`Invalid compose directory path: ${composeDir}`);
    if (!composeProject) throw new Error('Cannot determine compose project name from container labels');
    if (!/^[a-zA-Z0-9_-]+$/.test(composeProject)) throw new Error(`Invalid compose project name: ${composeProject}`);

    const currentImage = selfInfo.Config.Image;
    const imageBase = imageRepositoryFromRef(currentImage);

    logger.info('Update context', {
      composeDir,
      composeProject,
      imageBase,
      targetVersion,
      imageRef: artifact.imageRef,
    });

    if (!parseSemver(targetVersion)) throw new Error(`Invalid version format: ${targetVersion}`);

    const tag = normalizeVersionTag(targetVersion);
    if (artifact.payload.image !== imageBase) {
      throw new Error(`Signed update image ${artifact.payload.image} does not match running image ${imageBase}`);
    }
    if (artifact.payload.version !== tag) {
      throw new Error(`Signed update version ${artifact.payload.version} does not match requested ${tag}`);
    }

    await this.dockerService.pullImageRef(artifact.imageRef);

    await this.dockerService.pullImageRef(DOCKER_COMPOSE_CLI_IMAGE_REF);

    logger.info('Updating .env on host', { composeDir, envTag: tag, imageRef: artifact.imageRef });
    const envResult = await this.dockerService.runOneShot({
      Image: currentImage,
      Cmd: [
        'sh',
        '-c',
        `set -eu
tmp="/host/.env.tmp"
awk -v version="$GATEWAY_VERSION" -v image_ref="$GATEWAY_IMAGE_REF" '
  BEGIN { seen_version = 0; seen_ref = 0 }
  /^GATEWAY_VERSION=/ { print "GATEWAY_VERSION=" version; seen_version = 1; next }
  /^GATEWAY_IMAGE_REF=/ { print "GATEWAY_IMAGE_REF=" image_ref; seen_ref = 1; next }
  { print }
  END {
    if (!seen_version) print "GATEWAY_VERSION=" version
    if (!seen_ref) print "GATEWAY_IMAGE_REF=" image_ref
  }
' /host/.env > "$tmp"
mv "$tmp" /host/.env
if grep -q 'image: \${GATEWAY_IMAGE}:\${GATEWAY_VERSION}' /host/docker-compose.yml; then
  sed -i 's#image: \${GATEWAY_IMAGE}:\${GATEWAY_VERSION}#image: \${GATEWAY_IMAGE_REF}#' /host/docker-compose.yml
elif grep -q 'image: \${GATEWAY_IMAGE_REF}' /host/docker-compose.yml; then
  true
else
  echo "Unrecognized gateway app image line in docker-compose.yml" >&2
  exit 42
fi`,
      ],
      Env: [`GATEWAY_VERSION=${tag}`, `GATEWAY_IMAGE_REF=${artifact.imageRef}`],
      HostConfig: { Binds: [`${composeDir}:/host`] },
    });

    if (envResult.exitCode !== 0) throw new Error(`Failed to update .env: ${envResult.output}`);

    logger.info('.env updated, launching compose sidecar');

    await this.dockerService.runDetached({
      Image: DOCKER_COMPOSE_CLI_IMAGE_REF,
      Cmd: [
        'sh',
        '-c',
        `sleep 2 && docker compose --project-name ${composeProject} -f /project/docker-compose.yml up -d --force-recreate app`,
      ],
      HostConfig: { Binds: [`${composeDir}:/project`, '/var/run/docker.sock:/var/run/docker.sock'] },
    });

    logger.info('Update sidecar launched — container will be replaced shortly');
  }

  getGatewayManifestUrl(version: string): string {
    const tag = normalizeVersionTag(version);
    return `${this.gitlabApiUrl}/api/v4/projects/${this.encodedProjectPath}/packages/generic/gateway/${tag}/gateway-image.update.json`;
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

export function imageRepositoryFromRef(imageRef: string): string {
  const digestIndex = imageRef.indexOf('@');
  const withoutDigest = digestIndex >= 0 ? imageRef.slice(0, digestIndex) : imageRef;
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  if (lastColon > lastSlash) return withoutDigest.slice(0, lastColon);
  return withoutDigest;
}

function normalizeVersionTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}
