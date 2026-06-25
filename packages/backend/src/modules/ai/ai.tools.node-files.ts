import type { AIToolDefinition } from './ai.types.js';

export const NODE_FILE_AI_TOOLS: AIToolDefinition[] = [
  {
    name: 'manage_node_file',
    description:
      'List, read, create, write, move, delete, and upload files on a daemon node through the node file-management API. Use list/read for inspection and write/create/mkdir/delete/move/upload operations only when the user asked to change node files.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: { type: 'string', description: 'Node UUID' },
        operation: {
          type: 'string',
          enum: [
            'list',
            'read',
            'write',
            'create',
            'mkdir',
            'delete',
            'move',
            'upload_init',
            'upload_chunk',
            'upload_complete',
            'upload_abort',
          ],
          description: 'File operation to perform.',
        },
        path: { type: 'string', description: 'Absolute file or directory path on the node.' },
        fromPath: { type: 'string', description: 'Source path for move operations.' },
        toPath: { type: 'string', description: 'Destination path for move operations.' },
        content: { type: 'string', description: 'UTF-8 content for write/create operations.' },
        contentBase64: {
          type: 'string',
          description: 'Base64 content for binary write/create/upload_chunk operations.',
        },
        uploadId: { type: 'string', description: 'Upload session id for upload_chunk/complete/abort.' },
        offset: { type: 'number', description: 'Byte offset for upload_chunk.' },
        totalBytes: { type: 'number', description: 'Total upload size in bytes for upload_init/complete.' },
        encoding: {
          type: 'string',
          enum: ['auto', 'utf8', 'base64'],
          description: 'Read output encoding. Default auto returns utf8 for text and base64 for binary.',
        },
        limitBytes: {
          type: 'number',
          description: 'Maximum bytes returned by read. Default and max: 262144.',
        },
      },
      required: ['nodeId', 'operation'],
    },
    destructive: true,
    category: 'Nodes',
    requiredScope: 'nodes:files:read',
    invalidateStores: ['nodes'],
  },
];
