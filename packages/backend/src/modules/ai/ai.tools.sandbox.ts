import type { AIToolDefinition } from './ai.types.js';

export const SANDBOX_AI_TOOLS: AIToolDefinition[] = [
  {
    name: 'execute_script',
    description:
      'Execute a short script in a fresh Docker sandbox container. The container is user-scoped, resource-limited, has no network access, and is removed after execution. Use fetch or download_artifact for network content. You may request ttlSeconds, but it is capped by the selected resource tier.',
    parameters: {
      type: 'object',
      properties: {
        runtime: { type: 'string', enum: ['alpine', 'node', 'python'], description: 'Sandbox runtime image family.' },
        script: { type: 'string', description: 'Script body to execute inside the sandbox.' },
        resourceTier: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Resource tier. Default: low.' },
        ttlSeconds: { type: 'number', description: 'Requested TTL in seconds. Clamped to tier max.' },
      },
      required: ['script'],
    },
    destructive: true,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
  {
    name: 'run_process',
    description:
      'Start a bounded long-running process in a Docker sandbox container with no network access. Use download_artifact to place network files into it, read_process_output to inspect output, and kill_process to stop it. TTL is capped by tier.',
    parameters: {
      type: 'object',
      properties: {
        runtime: { type: 'string', enum: ['alpine', 'node', 'python'], description: 'Sandbox runtime image family.' },
        command: { type: 'array', items: { type: 'string' }, description: 'Command argv to run in the sandbox.' },
        resourceTier: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Resource tier. Default: low.' },
        ttlSeconds: { type: 'number', description: 'Requested TTL in seconds. Clamped to tier max.' },
      },
      required: ['command'],
    },
    destructive: true,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
  {
    name: 'fetch',
    description:
      'Fetch content from the network through the Gateway runner, outside the sandbox container. Use this for URLs when you only need the response content. Response size is capped at 10 MB.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP or HTTPS URL to fetch.' },
      },
      required: ['url'],
    },
    destructive: false,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
  {
    name: 'download_artifact',
    description:
      'Download a network file through Gateway and copy it into a running sandbox container. Use this instead of curl/wget inside the sandbox. Download size is capped at 200 MB.',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: 'Process ID returned by run_process.' },
        url: { type: 'string', description: 'HTTP or HTTPS URL to download.' },
        path: {
          type: 'string',
          description: 'Relative destination path inside /workspace. Defaults to artifacts/<filename>.',
        },
      },
      required: ['processId', 'url'],
    },
    destructive: false,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
  {
    name: 'read_artifact',
    description:
      'Read a file from a running sandbox container in chunks. Use offset and length for large files. Each read is capped at 1 MB.',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: 'Process ID returned by run_process.' },
        path: { type: 'string', description: 'Relative file path inside /workspace.' },
        offset: { type: 'number', description: 'Byte offset to start reading from. Default: 0.' },
        length: { type: 'number', description: 'Maximum bytes to read. Capped at 1 MB.' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Return encoding. Default: utf8.' },
      },
      required: ['processId', 'path'],
    },
    destructive: false,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
  {
    name: 'send_artifact',
    description:
      'Send a sandbox file to the user as a Gateway-managed downloadable artifact. The file is saved by Gateway and the chat receives a download link. File size is capped at 10 MB.',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: 'Process ID returned by run_process.' },
        path: { type: 'string', description: 'Relative file path inside /workspace.' },
        filename: { type: 'string', description: 'User-facing download filename.' },
        mediaType: { type: 'string', description: 'MIME type. Default: application/octet-stream.' },
      },
      required: ['processId', 'path'],
    },
    destructive: false,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
  {
    name: 'read_process_output',
    description: 'Read recent stdout/stderr from a running sandbox process.',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: 'Process ID returned by run_process.' },
        tail: { type: 'number', description: 'Approximate number of log lines to read. Default: 200.' },
      },
      required: ['processId'],
    },
    destructive: false,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
  {
    name: 'write_process_stdin',
    description: 'Write data to stdin of a running sandbox process when the runner supports interactive stdin.',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: 'Process ID returned by run_process.' },
        data: { type: 'string', description: 'Data to write to stdin.' },
        close: { type: 'boolean', description: 'Close stdin after writing.' },
      },
      required: ['processId', 'data'],
    },
    destructive: true,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
  {
    name: 'kill_process',
    description: 'Force-kill a running sandbox process owned by the current user.',
    parameters: {
      type: 'object',
      properties: {
        processId: { type: 'string', description: 'Process ID returned by run_process.' },
      },
      required: ['processId'],
    },
    destructive: true,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
  {
    name: 'list_sandbox_jobs',
    description: 'List current user sandbox jobs and running sandbox processes.',
    parameters: {
      type: 'object',
      properties: {
        activeOnly: { type: 'boolean', description: 'Only show queued/running jobs.' },
        limit: { type: 'number', description: 'Maximum jobs to return. Default: 25.' },
      },
    },
    destructive: false,
    category: 'Sandbox',
    requiredScope: 'ai:sandbox:use',
    invalidateStores: [],
  },
];
