import type { AIToolDefinition } from './ai.types.js';

export const DATABASE_AI_TOOLS: AIToolDefinition[] = [
  {
    name: 'list_databases',
    description: 'List saved database connections managed by Gateway.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['postgres', 'redis'], description: 'Optional provider filter' },
        healthStatus: {
          type: 'string',
          enum: ['online', 'offline', 'degraded', 'unknown'],
          description: 'Optional health status filter',
        },
        search: { type: 'string', description: 'Optional text search' },
      },
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:view',
    invalidateStores: [],
  },
  {
    name: 'get_database_connection',
    description: 'Get a saved database connection by ID, including provider, host, status, and safe config fields.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
      },
      required: ['databaseId'],
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:view',
    invalidateStores: [],
  },
  {
    name: 'query_postgres_read',
    description: 'Run a single read-only SQL statement against a saved Postgres connection.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        sql: { type: 'string', description: 'Single read-only SQL statement' },
      },
      required: ['databaseId', 'sql'],
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'execute_postgres_sql',
    description:
      'Run a SQL statement against a saved Postgres connection. Required permission is inferred from the SQL intent: read, write, or admin.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        sql: { type: 'string', description: 'Single SQL statement' },
      },
      required: ['databaseId', 'sql'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'browse_redis_keys',
    description: 'Browse keys in a saved Redis connection using SCAN.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        search: { type: 'string', description: 'Optional SCAN match pattern or substring search' },
        type: { type: 'string', description: 'Optional Redis TYPE filter' },
      },
      required: ['databaseId'],
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'get_redis_key',
    description: 'Get the value, type, and TTL of a Redis key from a saved connection.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        key: { type: 'string', description: 'Redis key name' },
      },
      required: ['databaseId', 'key'],
    },
    destructive: false,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'set_redis_key',
    description: 'Create or replace a Redis key using the visual-editor-compatible payload format.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        key: { type: 'string', description: 'Redis key name' },
        type: { type: 'string', enum: ['string', 'hash', 'list', 'set', 'zset'], description: 'Redis value type' },
        value: {
          type: 'object',
          description:
            'Value payload. Use a JSON string for string type, object for hash, array for list/set, array of {member,score} for zset.',
        },
        ttlSeconds: { type: 'number', description: 'Optional TTL in seconds' },
      },
      required: ['databaseId', 'key', 'type', 'value'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:write',
    invalidateStores: [],
  },
  {
    name: 'execute_redis_command',
    description: 'Run a single Redis command against a saved Redis connection.',
    parameters: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', description: 'Database connection UUID' },
        command: { type: 'string', description: 'Single Redis command line' },
      },
      required: ['databaseId', 'command'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:admin',
    invalidateStores: [],
  },
  {
    name: 'manage_database_connection',
    description:
      'Manage saved database connections. Operations: create, update, delete, test, reveal_credentials, health_history. Operation-specific database scopes are enforced.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'test', 'reveal_credentials', 'health_history'],
        },
        databaseId: { type: 'string', description: 'Database connection UUID for update/delete/test/reveal/history' },
        type: { type: 'string', enum: ['postgres', 'redis'] },
        name: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        manualSizeLimitMb: { type: 'number' },
        config: {
          type: 'object',
          description:
            'Connection config. Postgres: connectionString or host/port/database/username/password/sslEnabled. Redis: connectionString or host/port/username/password/db/tlsEnabled.',
        },
      },
      required: ['operation'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:view',
    invalidateStores: [],
  },
  {
    name: 'manage_postgres_data',
    description:
      'Explore and edit Postgres data for a saved connection. Operations: list_schemas, list_tables, table_metadata, browse_rows, insert_row, update_row, delete_row, add_column, update_column_type, delete_column.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [
            'list_schemas',
            'list_tables',
            'table_metadata',
            'browse_rows',
            'insert_row',
            'update_row',
            'delete_row',
            'add_column',
            'update_column_type',
            'delete_column',
          ],
        },
        databaseId: { type: 'string' },
        schema: { type: 'string' },
        table: { type: 'string' },
        page: { type: 'number' },
        limit: { type: 'number' },
        sortBy: { type: 'string' },
        sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        searchColumn: { type: 'string' },
        searchOperation: { type: 'string', enum: ['like', 'equals', 'notEquals', 'greaterThan', 'lessThan'] },
        searchValue: { type: 'string' },
        values: { type: 'object' },
        primaryKey: { type: 'object' },
        column: { type: 'string' },
        dataType: { type: 'string' },
      },
      required: ['operation', 'databaseId'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
  {
    name: 'manage_redis_data',
    description:
      'Explore and edit Redis data for a saved connection. Operations: scan_keys, get_key, set_key, delete_key, expire_key, execute_command. Command intent controls required read/write/admin query scope.',
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['scan_keys', 'get_key', 'set_key', 'delete_key', 'expire_key', 'execute_command'],
        },
        databaseId: { type: 'string' },
        cursor: { type: 'number' },
        limit: { type: 'number' },
        search: { type: 'string' },
        key: { type: 'string' },
        type: { type: 'string' },
        value: {},
        ttlSeconds: { type: 'number' },
        command: { type: 'string' },
        offset: { type: 'number' },
        maxStringBytes: { type: 'number' },
      },
      required: ['operation', 'databaseId'],
    },
    destructive: true,
    category: 'Databases',
    requiredScope: 'databases:query:read',
    invalidateStores: [],
  },
];
