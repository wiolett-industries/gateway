import { isVersionOlder } from './docker-migration-preflight-rules.js';

export interface MigrationCapabilityIssue {
  code: string;
  message: string;
}

export function compareDockerMigrationCapabilities(
  source: Record<string, any> | null,
  target: Record<string, any> | null
): MigrationCapabilityIssue[] {
  if (!source || !target) return [];
  const issues: MigrationCapabilityIssue[] = [];
  for (const [label, keys] of [
    ['operating system', ['osType', 'os_type']],
    ['architecture', ['architecture', 'arch']],
    ['storage driver', ['storageDriver', 'storage_driver']],
  ] as const) {
    const left = keys.map((key) => source[key]).find((value) => value !== undefined);
    const right = keys.map((key) => target[key]).find((value) => value !== undefined);
    if (!left || !right) {
      issues.push({ code: 'MIGRATION_CAPABILITY_UNKNOWN', message: `Docker ${label} capability is unknown` });
    } else if (left !== right) {
      issues.push({ code: 'MIGRATION_CAPABILITY_MISMATCH', message: `Docker ${label} is incompatible` });
    }
  }
  for (const [label, sourceVersion, targetVersion] of [
    ['API', source.apiVersion ?? source.api_version, target.apiVersion ?? target.api_version],
    ['engine', source.engineVersion ?? source.engine_version, target.engineVersion ?? target.engine_version],
  ]) {
    const targetOlder = isVersionOlder(targetVersion, sourceVersion);
    if (targetOlder === null) {
      issues.push({ code: 'MIGRATION_CAPABILITY_UNKNOWN', message: `Docker ${label} compatibility is unknown` });
    } else if (targetOlder) {
      issues.push({
        code: 'MIGRATION_CAPABILITY_MISMATCH',
        message: `Target Docker ${label} version is older than the source`,
      });
    }
  }
  return issues;
}

export function migrationCapacityFreeBytes(capabilities: Record<string, any> | null): number | null {
  if (!capabilities) return null;
  const values = [capabilities.dockerRootDir?.freeBytes, capabilities.stateDir?.freeBytes]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return values.length > 0 ? Math.min(...values) : null;
}

export function migrationStateDirFreeBytes(capabilities: Record<string, any> | null): number | null {
  const value = Number(capabilities?.stateDir?.freeBytes);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
