import type { AIToolDefinition } from './ai.types.js';

export const OPERATION_AI_TOOLS: AIToolDefinition[] = [
  {
    name: 'manage_logging',
    description:
      'Manage external logging environments, schemas, ingest tokens, metadata, facets, and search. Operation-specific logs:* scopes are enforced.',
    parameters: {
      type: 'object',
      properties: {
        resource: { type: 'string', enum: ['environment', 'schema', 'token', 'logs', 'metadata', 'facets'] },
        operation: {
          type: 'string',
          enum: ['list', 'get', 'create', 'update', 'delete', 'search', 'facets', 'metadata'],
        },
        environmentId: { type: 'string' },
        schemaId: { type: 'string' },
        tokenId: { type: 'string' },
        search: { type: 'string' },
        payload: { type: 'object', description: 'Create/update/search/facets body matching the logging API schema' },
      },
      required: ['resource', 'operation'],
    },
    destructive: true,
    category: 'Logging',
    requiredScope: 'logs:environments:view',
    invalidateStores: [],
  },
  {
    name: 'manage_status_page',
    description:
      'Manage the status page settings, service list, incidents, incident updates, proxy template options, and preview. Operation-specific status-page:* scopes are enforced.',
    parameters: {
      type: 'object',
      properties: {
        resource: {
          type: 'string',
          enum: ['settings', 'proxy_templates', 'services', 'incidents', 'incident_updates', 'preview'],
        },
        operation: {
          type: 'string',
          enum: ['get', 'list', 'update', 'create', 'delete', 'resolve', 'promote', 'create_update', 'preview'],
        },
        serviceId: { type: 'string' },
        incidentId: { type: 'string' },
        status: { type: 'string', enum: ['active', 'resolved', 'all'] },
        limit: { type: 'number' },
        payload: { type: 'object', description: 'Create/update body matching the status page API schema' },
      },
      required: ['resource', 'operation'],
    },
    destructive: true,
    category: 'Status Page',
    requiredScope: 'status-page:view',
    invalidateStores: [],
  },
];
