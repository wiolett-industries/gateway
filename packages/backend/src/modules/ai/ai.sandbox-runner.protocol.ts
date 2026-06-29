import type { SandboxJobKind, SandboxResourceTier, SandboxRuntime } from './ai.sandbox-policy.js';

export type SandboxRunnerMethod =
  | 'health'
  | 'executeScript'
  | 'runProcess'
  | 'fetch'
  | 'downloadArtifact'
  | 'readArtifact'
  | 'sendArtifact'
  | 'readProcessOutput'
  | 'writeProcessStdin'
  | 'killProcess'
  | 'revokeUserSandboxAccess'
  | 'reconcile';

export interface SandboxRunnerRequest<TParams = unknown> {
  id: string;
  method: SandboxRunnerMethod;
  params: TParams;
}

export interface SandboxRunnerResponse<TResult = unknown> {
  id: string;
  result?: TResult;
  error?: string;
}

export interface SandboxRunnerJobPolicy {
  jobId: string;
  userId: string;
  conversationId?: string | null;
  kind: SandboxJobKind;
  runtime: SandboxRuntime;
  tier: SandboxResourceTier;
  ttlSeconds: number;
  requiredScopes: string[];
  cpuQuota: number;
  memoryBytes: number;
  workspaceBytes: number;
  pidsLimit: number;
}

export interface SandboxRunnerExecuteScriptParams {
  policy: SandboxRunnerJobPolicy;
  script: string;
}

export interface SandboxRunnerRunProcessParams {
  policy: SandboxRunnerJobPolicy;
  command: string[];
}

export interface SandboxRunnerProcessParams {
  processId: string;
}

export interface SandboxRunnerFetchParams {
  url: string;
}

export interface SandboxRunnerDownloadArtifactParams extends SandboxRunnerProcessParams {
  url: string;
  path?: string;
}

export interface SandboxRunnerReadArtifactParams extends SandboxRunnerProcessParams {
  path: string;
  offset?: number;
  length?: number;
  encoding?: 'utf8' | 'base64';
}

export interface SandboxRunnerSendArtifactParams extends SandboxRunnerProcessParams {
  path: string;
  filename?: string;
  mediaType?: string;
}

export interface SandboxRunnerReadOutputParams extends SandboxRunnerProcessParams {
  tail?: number;
}

export interface SandboxRunnerWriteStdinParams extends SandboxRunnerProcessParams {
  data: string;
  close?: boolean;
}

export interface SandboxRunnerRevokeUserParams {
  userId: string;
  currentScopes: string[];
  reason: string;
}

export interface SandboxRunnerExecutionResult {
  jobId: string;
  containerId: string;
  exitCode: number;
  output: string;
  outputBytes: number;
  timedOut: boolean;
}

export interface SandboxRunnerProcessResult {
  processId: string;
  jobId: string;
  containerId: string;
  expiresAt: string;
}

export interface SandboxRunnerReadOutputResult {
  processId: string;
  output: string;
  outputBytes: number;
}

export interface SandboxRunnerFetchResult {
  url: string;
  status: number;
  contentType: string | null;
  sizeBytes: number;
  encoding: 'utf8' | 'base64';
  content?: string;
  contentBase64?: string;
}

export interface SandboxRunnerDownloadArtifactResult {
  processId: string;
  url: string;
  status: number;
  path: string;
  sizeBytes: number;
  contentType: string | null;
}

export interface SandboxRunnerReadArtifactResult {
  processId: string;
  path: string;
  offset: number;
  totalBytes: number;
  bytesRead: number;
  eof: boolean;
  encoding: 'utf8' | 'base64';
  content?: string;
  contentBase64?: string;
}

export interface SandboxRunnerSendArtifactResult {
  processId: string;
  path: string;
  filename: string;
  mediaType: string;
  sizeBytes: number;
  tempFilePath: string;
}

export interface SandboxRunnerWriteStdinResult {
  processId: string;
  bytesWritten: number;
  closed: boolean;
  closeUnsupported?: boolean;
}

export interface SandboxRunnerKillResult {
  processId: string;
  killed: boolean;
}

export interface SandboxRunnerHealth {
  ok: boolean;
  version: 1;
}
