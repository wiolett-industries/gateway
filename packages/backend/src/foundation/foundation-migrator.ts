import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_SANDBOX_WORKSPACE_DIR = '/var/lib/gateway/sandbox-workspaces';

const SANDBOX_VOLUME_START = '# gateway-managed:start sandbox-workspace';
const SANDBOX_VOLUME_END = '# gateway-managed:end sandbox-workspace';

export interface FoundationMigrationOptions {
  hostDir: string;
  targetVersion?: string;
  imageRef?: string;
  sandboxWorkspaceDir?: string;
}

export interface FoundationMigrationResult {
  changedFiles: string[];
  backupDir: string | null;
  sandboxWorkspaceDir: string;
}

interface PendingFoundationWrite {
  relativePath: string;
  filePath: string;
  content: string;
}

interface EnvPatchResult {
  content: string;
  values: Map<string, string>;
}

export async function runFoundationMigrations(options: FoundationMigrationOptions): Promise<FoundationMigrationResult> {
  const hostDir = path.resolve(options.hostDir);
  const envPath = path.join(hostDir, '.env');
  const composePath = path.join(hostDir, 'docker-compose.yml');
  const backupDir = path.join(hostDir, '.gateway-foundation-backups', timestampForPath(new Date()));
  const defaultSandboxWorkspaceDir = options.sandboxWorkspaceDir ?? DEFAULT_SANDBOX_WORKSPACE_DIR;

  const envContent = await fs.readFile(envPath, 'utf8');
  const envPatch = patchEnv(envContent, {
    ...(options.targetVersion ? { GATEWAY_VERSION: options.targetVersion } : {}),
    ...(options.imageRef ? { GATEWAY_IMAGE_REF: options.imageRef } : {}),
    SANDBOX_RUNNER_WORKSPACE_DIR: envValue(envContent, 'SANDBOX_RUNNER_WORKSPACE_DIR') ?? defaultSandboxWorkspaceDir,
  });

  const composeContent = await fs.readFile(composePath, 'utf8');
  const composePatch = patchCompose(composeContent);

  const effectiveSandboxWorkspaceDir =
    envPatch.values.get('SANDBOX_RUNNER_WORKSPACE_DIR') ?? defaultSandboxWorkspaceDir;

  const pendingWrites: PendingFoundationWrite[] = [];
  if (envPatch.content !== envContent) {
    pendingWrites.push({ relativePath: '.env', filePath: envPath, content: envPatch.content });
  }
  if (composePatch !== composeContent) {
    pendingWrites.push({ relativePath: 'docker-compose.yml', filePath: composePath, content: composePatch });
  }

  if (pendingWrites.length > 0) {
    for (const write of pendingWrites) {
      await backupFile(write.filePath, backupDir);
    }

    try {
      for (const write of pendingWrites) {
        await writeFileAtomic(write.filePath, write.content);
      }
    } catch (error) {
      await restoreBackups(backupDir, pendingWrites).catch((rollbackError) => {
        throw new Error(
          `foundation migration failed and rollback failed: ${formatError(error)}; rollback: ${formatError(rollbackError)}`
        );
      });
      throw error;
    }
  }

  if (path.isAbsolute(effectiveSandboxWorkspaceDir)) {
    await fs.mkdir(effectiveSandboxWorkspaceDir, { recursive: true, mode: 0o700 }).catch(() => {});
    await fs.chmod(effectiveSandboxWorkspaceDir, 0o700).catch(() => {});
  }

  return {
    changedFiles: pendingWrites.map((write) => write.relativePath),
    backupDir: pendingWrites.length > 0 ? backupDir : null,
    sandboxWorkspaceDir: effectiveSandboxWorkspaceDir,
  };
}

export function patchEnv(content: string, values: Record<string, string>): EnvPatchResult {
  const hadTrailingNewline = content.endsWith('\n');
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();

  const remaining = new Set(Object.keys(values));
  const seen = new Set<string>();
  const nextLines: string[] = [];
  const nextValues = parseEnvValues(content);

  for (const line of lines) {
    const key = envLineKey(line);
    if (!key || !(key in values)) {
      nextLines.push(line);
      continue;
    }
    if (seen.has(key)) continue;
    nextLines.push(`${key}=${values[key]}`);
    nextValues.set(key, values[key]);
    seen.add(key);
    remaining.delete(key);
  }

  if (remaining.size > 0 && nextLines.length > 0 && nextLines.at(-1) !== '') {
    nextLines.push('');
  }
  for (const key of remaining) {
    nextLines.push(`${key}=${values[key]}`);
    nextValues.set(key, values[key]);
  }

  return {
    content: `${nextLines.join('\n')}${hadTrailingNewline || nextLines.length > 0 ? '\n' : ''}`,
    values: nextValues,
  };
}

export function patchCompose(content: string): string {
  let lines = content.replace(/\r\n/g, '\n').split('\n');
  const hadTrailingNewline = lines.at(-1) === '';
  if (hadTrailingNewline) lines = lines.slice(0, -1);

  const appBlock = findServiceBlock(lines, 'app');
  if (!appBlock) throw new Error('foundation migration failed: services.app block not found in docker-compose.yml');

  const imagePatched = patchAppImage(lines, appBlock);
  const volumesPatched = patchAppSandboxVolume(imagePatched, findServiceBlock(imagePatched, 'app') ?? appBlock);
  return `${volumesPatched.join('\n')}${hadTrailingNewline ? '\n' : ''}`;
}

function patchAppImage(lines: string[], appBlock: { start: number; end: number; indent: number }): string[] {
  const next = [...lines];
  for (let index = appBlock.start + 1; index < appBlock.end; index += 1) {
    const match = /^(\s*)image\s*:/.exec(next[index]);
    if (!match) continue;
    next[index] = `${match[1]}image: \${GATEWAY_IMAGE_REF}`;
    return next;
  }
  throw new Error('foundation migration failed: services.app.image line not found in docker-compose.yml');
}

function patchAppSandboxVolume(lines: string[], appBlock: { start: number; end: number; indent: number }): string[] {
  const volumes = findNestedBlock(lines, appBlock, 'volumes');
  if (!volumes)
    throw new Error('foundation migration failed: services.app.volumes block not found in docker-compose.yml');

  const volumeIndent = `${' '.repeat(volumes.indent + 2)}`;
  const canonicalBlock = [
    `${volumeIndent}${SANDBOX_VOLUME_START}`,
    `${volumeIndent}- \${SANDBOX_RUNNER_WORKSPACE_DIR:-${DEFAULT_SANDBOX_WORKSPACE_DIR}}:\${SANDBOX_RUNNER_WORKSPACE_DIR:-${DEFAULT_SANDBOX_WORKSPACE_DIR}}`,
    `${volumeIndent}${SANDBOX_VOLUME_END}`,
  ];

  const markerStart = findLineInRange(lines, volumes.start + 1, volumes.end, SANDBOX_VOLUME_START);
  const markerEnd = findLineInRange(lines, volumes.start + 1, volumes.end, SANDBOX_VOLUME_END);
  if (markerStart >= 0 || markerEnd >= 0) {
    if (markerStart < 0 || markerEnd < markerStart) {
      throw new Error('foundation migration failed: malformed sandbox workspace managed block');
    }
    return [...lines.slice(0, markerStart), ...canonicalBlock, ...lines.slice(markerEnd + 1)];
  }

  const existingVolume = findExistingSandboxVolume(lines, volumes.start + 1, volumes.end);
  if (existingVolume >= 0) {
    return [...lines.slice(0, existingVolume), ...canonicalBlock, ...lines.slice(existingVolume + 1)];
  }

  const dockerSocketLine = findDockerSocketVolume(lines, volumes.start + 1, volumes.end);
  const insertAt = dockerSocketLine >= 0 ? dockerSocketLine + 1 : volumes.end;
  return [...lines.slice(0, insertAt), ...canonicalBlock, ...lines.slice(insertAt)];
}

function findServiceBlock(lines: string[], serviceName: string): { start: number; end: number; indent: number } | null {
  const servicesBlock = findTopLevelBlock(lines, 'services');
  if (!servicesBlock) return null;
  return findDirectNestedBlock(lines, servicesBlock, serviceName);
}

function findTopLevelBlock(lines: string[], key: string): { start: number; end: number; indent: number } | null {
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*:\\s*(?:#.*)?$`);
  for (let index = 0; index < lines.length; index += 1) {
    if (!pattern.test(lines[index])) continue;
    return { start: index, end: findBlockEnd(lines, index + 1, 0), indent: 0 };
  }
  return null;
}

function findDirectNestedBlock(
  lines: string[],
  parent: { start: number; end: number; indent: number },
  key: string
): { start: number; end: number; indent: number } | null {
  const directIndent = firstChildIndent(lines, parent);
  if (directIndent === null) return null;
  const nestedPattern = new RegExp(`^(\\s{${directIndent}})${escapeRegExp(key)}\\s*:\\s*(?:#.*)?$`);
  for (let index = parent.start + 1; index < parent.end; index += 1) {
    const match = nestedPattern.exec(lines[index]);
    if (!match) continue;
    return {
      start: index,
      end: Math.min(findBlockEnd(lines, index + 1, directIndent), parent.end),
      indent: directIndent,
    };
  }
  return null;
}

function firstChildIndent(lines: string[], parent: { start: number; end: number; indent: number }): number | null {
  for (let index = parent.start + 1; index < parent.end; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (indent > parent.indent) return indent;
  }
  return null;
}

function findNestedBlock(
  lines: string[],
  parent: { start: number; end: number; indent: number },
  key: string
): { start: number; end: number; indent: number } | null {
  const nestedPattern = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*:\\s*(?:#.*)?$`);
  for (let index = parent.start + 1; index < parent.end; index += 1) {
    const match = nestedPattern.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    if (indent <= parent.indent) continue;
    return { start: index, end: Math.min(findBlockEnd(lines, index + 1, indent), parent.end), indent };
  }
  return null;
}

function findBlockEnd(lines: string[], start: number, indent: number): number {
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const currentIndent = line.length - line.trimStart().length;
    if (currentIndent <= indent) return index;
  }
  return lines.length;
}

function findLineInRange(lines: string[], start: number, end: number, text: string): number {
  for (let index = start; index < end; index += 1) {
    if (lines[index].includes(text)) return index;
  }
  return -1;
}

function findExistingSandboxVolume(lines: string[], start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    const line = lines[index];
    if (
      line.includes('SANDBOX_RUNNER_WORKSPACE_DIR') ||
      line.includes(`${DEFAULT_SANDBOX_WORKSPACE_DIR}:${DEFAULT_SANDBOX_WORKSPACE_DIR}`)
    ) {
      return index;
    }
  }
  return -1;
}

function findDockerSocketVolume(lines: string[], start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (/^\s*-\s+\/var\/run\/docker\.sock:/.test(lines[index])) return index;
  }
  return -1;
}

function envValue(content: string, key: string): string | null {
  return parseEnvValues(content).get(key) ?? null;
}

function parseEnvValues(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const key = envLineKey(line);
    if (!key || values.has(key)) continue;
    values.set(key, line.slice(key.length + 1));
  }
  return values;
}

function envLineKey(line: string): string | null {
  const match = /^([A-Z_][A-Z0-9_]*)=/.exec(line);
  return match?.[1] ?? null;
}

async function backupFile(filePath: string, backupDir: string): Promise<void> {
  await fs.mkdir(backupDir, { recursive: true });
  await fs.copyFile(filePath, path.join(backupDir, path.basename(filePath)));
}

async function restoreBackups(backupDir: string, writes: PendingFoundationWrite[]): Promise<void> {
  for (const write of writes) {
    const backupPath = path.join(backupDir, path.basename(write.filePath));
    const backupStat = await fs.stat(backupPath);
    await fs.copyFile(backupPath, write.filePath);
    await fs.chmod(write.filePath, backupStat.mode & 0o777);
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const stat = await fs.stat(filePath).catch(() => null);
  await fs.writeFile(tempPath, content, { mode: stat ? stat.mode & 0o777 : 0o600 });
  await fs.rename(tempPath, filePath);
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
