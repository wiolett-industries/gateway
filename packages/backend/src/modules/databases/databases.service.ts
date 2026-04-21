import { createHash } from 'node:crypto';
import { count, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import Redis from 'ioredis';
import pg from 'pg';
import type { DrizzleClient } from '@/db/client.js';
import { databaseConnections, type DatabaseHealthEntry } from '@/db/schema/index.js';
import { buildWhere } from '@/lib/utils.js';
import { createChildLogger } from '@/lib/logger.js';
import { AppError } from '@/middleware/error-handler.js';
import type { AuditService } from '@/modules/audit/audit.service.js';
import type {
  CreateDatabaseConnectionInput,
  DatabaseListQuery,
  UpdateDatabaseConnectionInput,
} from './databases.schemas.js';
import type { EventBusService } from '@/services/event-bus.service.js';
import type { CryptoService } from '@/services/crypto.service.js';
import type { PaginatedResponse } from '@/types.js';

const logger = createChildLogger('DatabaseConnectionService');
const { Pool } = pg;
const DATABASE_HEALTH_HISTORY_MIN_INTERVAL_MS = 30_000;
const DATABASE_HEALTH_HISTORY_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export type DatabaseType = 'postgres' | 'redis';
export type DatabaseHealthStatus = 'online' | 'offline' | 'degraded' | 'unknown';
export type DatabaseOperation = 'connect' | 'query';

export interface PostgresConnectionConfig {
  type: 'postgres';
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
}

export interface RedisConnectionConfig {
  type: 'redis';
  host: string;
  port: number;
  username: string | null;
  password: string;
  db: number;
  tlsEnabled: boolean;
}

export type DatabaseConnectionConfig = PostgresConnectionConfig | RedisConnectionConfig;

export interface DatabaseConnectionView {
  id: string;
  name: string;
  type: DatabaseType;
  description: string | null;
  tags: string[];
  manualSizeLimitMb: number | null;
  host: string;
  port: number;
  databaseName: string | null;
  username: string | null;
  tlsEnabled: boolean;
  healthStatus: DatabaseHealthStatus;
  lastHealthCheckAt: string | null;
  lastError: string | null;
  healthHistory: DatabaseHealthEntry[];
  hasStoredPassword: boolean;
  config: Record<string, unknown>;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

const DATABASE_CONNECTIVITY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EPIPE',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const POSTGRES_CONNECTIVITY_CODES = new Set(['3D000']);
const POSTGRES_QUERY_CODES = new Set(['42601', '42703', '42P01']);
const REDIS_QUERY_MESSAGES = [/unknown command/i, /wrong number of arguments/i, /wrongtype/i];

export function mapDatabaseDriverError(
  error: unknown,
  provider: DatabaseType,
  operation: DatabaseOperation
): AppError | null {
  if (error instanceof AppError) return error;
  if (!(error instanceof Error)) return null;

  const driverError = error as Error & { code?: string; errno?: string | number };
  const code =
    typeof driverError.code === 'string'
      ? driverError.code
      : typeof driverError.errno === 'string'
        ? driverError.errno
        : undefined;
  const message = driverError.message || `${provider} ${operation} failed`;
  const lowerMessage = message.toLowerCase();

  if (
    (provider === 'postgres' &&
      (code === '28P01' ||
        lowerMessage.includes('password authentication failed') ||
        lowerMessage.includes('no pg_hba.conf entry'))) ||
    (provider === 'redis' &&
      (lowerMessage.includes('wrongpass') ||
        lowerMessage.includes('authentication required') ||
        lowerMessage.includes('invalid username-password') ||
        lowerMessage.includes('auth <password> called without any password configured') ||
        lowerMessage.includes('noauth')))
  ) {
    return new AppError(401, 'DATABASE_AUTH_FAILED', message);
  }

  if (
    DATABASE_CONNECTIVITY_ERROR_CODES.has(code ?? '') ||
    (provider === 'postgres' && POSTGRES_CONNECTIVITY_CODES.has(code ?? '')) ||
    lowerMessage.includes('database does not exist') ||
    lowerMessage.includes('getaddrinfo') ||
    lowerMessage.includes('connect timeout') ||
    lowerMessage.includes('connection terminated unexpectedly') ||
    lowerMessage.includes('server does not support ssl') ||
    lowerMessage.includes('self signed certificate') ||
    lowerMessage.includes('certificate has expired') ||
    lowerMessage.includes('unable to verify the first certificate') ||
    lowerMessage.includes('connection is closed')
  ) {
    return new AppError(422, 'DATABASE_CONNECTION_FAILED', message);
  }

  if (
    operation === 'query' &&
    ((provider === 'postgres' && POSTGRES_QUERY_CODES.has(code ?? '')) ||
      (provider === 'redis' && REDIS_QUERY_MESSAGES.some((pattern) => pattern.test(message))))
  ) {
    return new AppError(400, 'DATABASE_QUERY_FAILED', message);
  }

  return null;
}

function quoteIdent(identifier: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(identifier)) {
    throw new AppError(400, 'INVALID_IDENTIFIER', `Invalid identifier: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

function maskValue(value: string | null | undefined): string {
  return value ? '••••••••' : '';
}

function hashPreview(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function splitPostgresStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarQuoteTag: string | null = null;

  while (i < sql.length) {
    const char = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      current += char;
      if (char === '\n') inLineComment = false;
      i += 1;
      continue;
    }

    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        inBlockComment = false;
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, i)) {
        current += dollarQuoteTag;
        i += dollarQuoteTag.length;
        dollarQuoteTag = null;
      } else {
        current += char;
        i += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        i += 2;
        continue;
      }
      if (char === "'") inSingleQuote = false;
      i += 1;
      continue;
    }

    if (inDoubleQuote) {
      current += char;
      if (char === '"' && next === '"') {
        current += next;
        i += 2;
        continue;
      }
      if (char === '"') inDoubleQuote = false;
      i += 1;
      continue;
    }

    if (char === '-' && next === '-') {
      current += char + next;
      inLineComment = true;
      i += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      current += char + next;
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (char === "'") {
      current += char;
      inSingleQuote = true;
      i += 1;
      continue;
    }

    if (char === '"') {
      current += char;
      inDoubleQuote = true;
      i += 1;
      continue;
    }

    if (char === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        current += tag;
        dollarQuoteTag = tag;
        i += tag.length;
        continue;
      }
    }

    if (char === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  const finalStatement = current.trim();
  if (finalStatement) statements.push(finalStatement);
  if (statements.length === 0) {
    throw new AppError(400, 'INVALID_SQL', 'SQL statement is required');
  }
  return statements;
}

function splitRedisCommands(commandText: string): string[] {
  const commands: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < commandText.length; i += 1) {
    const char = commandText[i]!;

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }

    if (inSingleQuote) {
      current += char;
      if (char === "'") inSingleQuote = false;
      continue;
    }

    if (inDoubleQuote) {
      current += char;
      if (char === '"') inDoubleQuote = false;
      continue;
    }

    if (char === "'") {
      current += char;
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      current += char;
      inDoubleQuote = true;
      continue;
    }

    if (char === ';' || char === '\n') {
      const trimmed = current.trim();
      if (trimmed) commands.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) commands.push(trimmed);
  if (commands.length === 0) {
    throw new AppError(400, 'INVALID_COMMAND', 'Redis command is required');
  }
  if (inSingleQuote || inDoubleQuote || escaped) {
    throw new AppError(400, 'INVALID_COMMAND', 'Unterminated quoted Redis command');
  }
  return commands;
}

function tokenizeRedisCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i]!;

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inSingleQuote) {
      if (char === "'") {
        inSingleQuote = false;
      } else {
        current += char;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"') {
        inDoubleQuote = false;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrent();
      continue;
    }

    current += char;
  }

  if (escaped || inSingleQuote || inDoubleQuote) {
    throw new AppError(400, 'INVALID_COMMAND', 'Unterminated quoted Redis command');
  }

  pushCurrent();
  if (tokens.length === 0) {
    throw new AppError(400, 'INVALID_COMMAND', 'Redis command is required');
  }
  return tokens;
}

function inferPostgresStatementIntent(sql: string): 'read' | 'write' | 'admin' {
  const normalized = sql.trim().replace(/^\s+/, '').toLowerCase();
  const token = normalized.split(/\s+/, 1)[0] ?? '';
  if (['select', 'show', 'explain', 'values'].includes(token) || normalized.startsWith('with ')) {
    if (
      /\b(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|vacuum|reindex|comment|refresh|cluster|copy|lock|call|do)\b/i.test(
        normalized
      )
    ) {
      return 'admin';
    }
    return 'read';
  }
  if (['insert', 'update', 'delete', 'merge', 'copy', 'lock'].includes(token)) return 'write';
  return 'admin';
}

export function inferPostgresIntent(sql: string): 'read' | 'write' | 'admin' {
  const intents = splitPostgresStatements(sql).map(inferPostgresStatementIntent);
  if (intents.includes('admin')) return 'admin';
  if (intents.includes('write')) return 'write';
  return 'read';
}

function inferRedisSingleCommandIntent(command: string): 'read' | 'write' | 'admin' {
  const token = command.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
  if (
    [
      'get',
      'mget',
      'hget',
      'hgetall',
      'lrange',
      'llen',
      'smembers',
      'scard',
      'zrange',
      'zrevrange',
      'zcard',
      'ttl',
      'pttl',
      'type',
      'exists',
      'scan',
      'info',
      'xrange',
      'xrevrange',
      'keys',
      'dbsize',
      'ping',
    ].includes(token)
  ) {
    return 'read';
  }
  if (
    [
      'set',
      'mset',
      'del',
      'unlink',
      'expire',
      'persist',
      'rename',
      'hset',
      'hdel',
      'lpush',
      'rpush',
      'ltrim',
      'sadd',
      'srem',
      'zadd',
      'zrem',
      'incr',
      'decr',
      'xadd',
      'xdel',
    ].includes(token)
  ) {
    return 'write';
  }
  return 'admin';
}

export function inferRedisIntent(commandText: string): 'read' | 'write' | 'admin' {
  const intents = splitRedisCommands(commandText).map(inferRedisSingleCommandIntent);
  if (intents.includes('admin')) return 'admin';
  if (intents.includes('write')) return 'write';
  return 'read';
}

export class DatabaseConnectionService {
  private eventBus?: EventBusService;
  private readonly postgresPools = new Map<string, pg.Pool>();
  private readonly redisClients = new Map<string, Redis>();

  constructor(
    private readonly db: DrizzleClient,
    private readonly auditService: AuditService,
    private readonly cryptoService: CryptoService
  ) {}

  setEventBus(bus: EventBusService) {
    this.eventBus = bus;
  }

  async list(
    query: DatabaseListQuery,
    options?: {
      allowedIds?: string[];
    }
  ): Promise<PaginatedResponse<DatabaseConnectionView>> {
    const conditions: (SQL | undefined)[] = [];
    if (options?.allowedIds) {
      if (options.allowedIds.length === 0) {
        return {
          data: [],
          pagination: {
            page: query.page,
            limit: query.limit,
            total: 0,
            totalPages: 0,
          },
        };
      }
      conditions.push(inArray(databaseConnections.id, options.allowedIds));
    }
    if (query.search) {
      conditions.push(
        or(
          ilike(databaseConnections.name, `%${query.search}%`),
          ilike(databaseConnections.host, `%${query.search}%`),
          ilike(databaseConnections.databaseName, `%${query.search}%`)
        )
      );
    }
    if (query.type) conditions.push(eq(databaseConnections.type, query.type));
    if (query.healthStatus) conditions.push(eq(databaseConnections.healthStatus, query.healthStatus));

    const where = buildWhere(conditions);
    const [rows, [{ count: totalCount }]] = await Promise.all([
      this.db
        .select()
        .from(databaseConnections)
        .where(where)
        .orderBy(desc(databaseConnections.updatedAt))
        .limit(query.limit)
        .offset((query.page - 1) * query.limit),
      this.db.select({ count: count() }).from(databaseConnections).where(where),
    ]);

    const data = rows.map((row) => this.toView(row, this.decryptConfig(row.encryptedConfig), false));
    const total = Number(totalCount);
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(id: string, revealCredentials = false): Promise<DatabaseConnectionView> {
    const row = await this.getRow(id);
    return this.toView(row, this.decryptConfig(row.encryptedConfig), revealCredentials);
  }

  async revealCredentials(id: string): Promise<Record<string, unknown>> {
    const row = await this.getRow(id);
    const config = this.decryptConfig(row.encryptedConfig);
    return {
      ...config,
      connectionString: this.buildConnectionString(config),
    };
  }

  async create(input: CreateDatabaseConnectionInput, userId: string): Promise<DatabaseConnectionView> {
    const normalized = input.type === 'postgres' ? this.normalizePostgres(input.config) : this.normalizeRedis(input.config);
    const testResult = await this.testNormalizedConnection(normalized);
    const encryptedConfig = this.encryptConfig(normalized);
    const [row] = await this.db
      .insert(databaseConnections)
      .values({
        name: input.name,
        type: input.type,
        description: input.description ?? null,
        tags: input.tags ?? [],
        manualSizeLimitMb: input.type === 'postgres' ? (input.manualSizeLimitMb ?? null) : null,
        host: normalized.host,
        port: normalized.port,
        databaseName: normalized.type === 'postgres' ? normalized.database : `db${normalized.db}`,
        username: normalized.username ?? null,
        tlsEnabled: normalized.type === 'postgres' ? normalized.sslEnabled : normalized.tlsEnabled,
        encryptedConfig,
        healthStatus: testResult.status,
        lastHealthCheckAt: new Date(),
        lastError: null,
        healthHistory: [
          {
            ts: new Date().toISOString(),
            status: testResult.status,
            responseMs: testResult.responseMs,
            slow: testResult.status === 'degraded',
          },
        ],
        createdById: userId,
        updatedById: userId,
      })
      .returning();

    await this.auditService.log({
      userId,
      action: 'database.connection.create',
      resourceType: 'database',
      resourceId: row.id,
      details: { name: row.name, type: row.type, host: row.host, port: row.port },
    });
    this.emitChange(row.id, 'created', { name: row.name, type: row.type, healthStatus: row.healthStatus });
    return this.toView(row, normalized, false);
  }

  async update(id: string, input: UpdateDatabaseConnectionInput, userId: string): Promise<DatabaseConnectionView> {
    const existing = await this.getRow(id);
    const currentConfig = this.decryptConfig(existing.encryptedConfig);
    const nextPassword =
      input.config && 'password' in input.config ? input.config.password ?? currentConfig.password : currentConfig.password;
    const mergedConfig =
      currentConfig.type === 'postgres'
        ? this.normalizePostgres({
            host: currentConfig.host,
            port: currentConfig.port,
            database: currentConfig.database,
            username: currentConfig.username,
            sslEnabled: currentConfig.sslEnabled,
            ...(input.config ?? {}),
            password: nextPassword,
          })
        : this.normalizeRedis({
            host: currentConfig.host,
            port: currentConfig.port,
            username: currentConfig.username ?? undefined,
            db: currentConfig.db,
            tlsEnabled: currentConfig.tlsEnabled,
            ...(input.config ?? {}),
            password: nextPassword,
          });

    const connectionFieldsChanged = JSON.stringify(currentConfig) !== JSON.stringify(mergedConfig);
    let statusUpdate: Partial<typeof databaseConnections.$inferInsert> = {};
    if (connectionFieldsChanged) {
      const testResult = await this.testNormalizedConnection(mergedConfig);
      statusUpdate = {
        healthStatus: testResult.status,
        lastHealthCheckAt: new Date(),
        lastError: null,
      };
    }

    const [row] = await this.db
      .update(databaseConnections)
      .set({
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : (input.description ?? null),
        tags: input.tags ?? (existing.tags as string[]),
        manualSizeLimitMb:
          existing.type === 'postgres'
            ? (input.manualSizeLimitMb === undefined
                ? existing.manualSizeLimitMb
                : (input.manualSizeLimitMb ?? null))
            : null,
        host: mergedConfig.host,
        port: mergedConfig.port,
        databaseName: mergedConfig.type === 'postgres' ? mergedConfig.database : `db${mergedConfig.db}`,
        username: mergedConfig.username ?? null,
        tlsEnabled: mergedConfig.type === 'postgres' ? mergedConfig.sslEnabled : mergedConfig.tlsEnabled,
        encryptedConfig: this.encryptConfig(mergedConfig),
        updatedById: userId,
        updatedAt: new Date(),
        ...statusUpdate,
      })
      .where(eq(databaseConnections.id, id))
      .returning();

    this.disposeClient(id).catch(() => {});

    await this.auditService.log({
      userId,
      action: 'database.connection.update',
      resourceType: 'database',
      resourceId: id,
      details: {
        name: row.name,
        type: row.type,
        connectionChanged: connectionFieldsChanged,
        fields: Object.keys(input),
      },
    });
    this.emitChange(id, 'updated', { name: row.name, type: row.type, healthStatus: row.healthStatus });
    return this.toView(row, mergedConfig, false);
  }

  async delete(id: string, userId: string): Promise<void> {
    const existing = await this.getRow(id);
    await this.db.delete(databaseConnections).where(eq(databaseConnections.id, id));
    await this.disposeClient(id);

    await this.auditService.log({
      userId,
      action: 'database.connection.delete',
      resourceType: 'database',
      resourceId: id,
      details: { name: existing.name, type: existing.type, host: existing.host, port: existing.port },
    });
    this.emitChange(id, 'deleted', { name: existing.name, type: existing.type });
  }

  async testSavedConnection(id: string, userId: string): Promise<{ ok: true; responseMs: number; status: DatabaseHealthStatus }> {
    const row = await this.getRow(id);
    const config = this.decryptConfig(row.encryptedConfig);
    let result: { status: DatabaseHealthStatus; responseMs: number };
    try {
      result = await this.testNormalizedConnection(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Database connection test failed';
      await this.updateHealth(id, {
        status: 'offline',
        lastError: message,
        forceHistory: true,
      }).catch(() => {});
      throw error;
    }
    const history = this.trimHealthHistory([
      ...((row.healthHistory as DatabaseHealthEntry[] | null) ?? []),
      {
        ts: new Date().toISOString(),
        status: result.status,
        responseMs: result.responseMs,
        slow: result.status === 'degraded',
      },
    ]);
    await this.db
      .update(databaseConnections)
      .set({
        healthStatus: result.status,
        lastHealthCheckAt: new Date(),
        lastError: null,
        healthHistory: history,
        updatedAt: new Date(),
      })
      .where(eq(databaseConnections.id, id));

    await this.auditService.log({
      userId,
      action: 'database.connection.test',
      resourceType: 'database',
      resourceId: id,
      details: { name: row.name, type: row.type, responseMs: result.responseMs, status: result.status },
    });
    this.emitChange(id, 'tested', { name: row.name, type: row.type, healthStatus: result.status, responseMs: result.responseMs });
    return { ok: true, responseMs: result.responseMs, status: result.status };
  }

  async listPostgresSchemas(id: string) {
    return this.withPostgresPool(id, 'query', async (pool) => {
      const result = await pool.query<{ schema_name: string }>(
        `select distinct table_schema as schema_name
           from information_schema.tables
         where table_schema not in ('information_schema', 'pg_catalog')
         order by schema_name asc`
      );
      return result.rows.map((row) => row.schema_name);
    });
  }

  async listPostgresTables(id: string, schema: string) {
    return this.withPostgresPool(id, 'query', async (pool) => {
      const result = await pool.query<{
        table_name: string;
        table_type: string;
      }>(
        `select table_name, table_type
           from information_schema.tables
          where table_schema = $1
          order by table_name asc`,
        [schema]
      );
      return result.rows.map((row) => ({
        name: row.table_name,
        type: row.table_type === 'VIEW' ? 'view' : 'table',
      }));
    });
  }

  async getPostgresTableMetadata(id: string, schema: string, table: string) {
    return this.withPostgresPool(id, 'query', async (pool) => {
      const columns = await pool.query<{
        column_name: string;
        data_type: string;
        udt_name: string;
        is_nullable: 'YES' | 'NO';
        column_default: string | null;
        is_identity: 'YES' | 'NO';
        is_generated: 'ALWAYS' | 'NEVER';
        ordinal_position: number;
      }>(
        `select column_name, data_type, udt_name, is_nullable, column_default, is_identity, is_generated, ordinal_position
           from information_schema.columns
          where table_schema = $1 and table_name = $2
          order by ordinal_position asc`,
        [schema, table]
      );
      if (columns.rows.length === 0) {
        throw new AppError(404, 'TABLE_NOT_FOUND', 'Table or view not found');
      }

      const primaryKeys = await pool.query<{ column_name: string }>(
        `select kcu.column_name
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on tc.constraint_name = kcu.constraint_name
            and tc.table_schema = kcu.table_schema
          where tc.constraint_type = 'PRIMARY KEY'
            and tc.table_schema = $1
            and tc.table_name = $2
          order by kcu.ordinal_position asc`,
        [schema, table]
      );

      const pkSet = new Set(primaryKeys.rows.map((row) => row.column_name));
      return {
        schema,
        table,
        columns: columns.rows.map((column) => ({
          name: column.column_name,
          dataType: column.data_type,
          udtName: column.udt_name,
          nullable: column.is_nullable === 'YES',
          isPrimaryKey: pkSet.has(column.column_name),
          hasDefault: column.column_default !== null || column.is_identity === 'YES' || column.is_generated === 'ALWAYS',
        })),
        primaryKey: primaryKeys.rows.map((row) => row.column_name),
        hasPrimaryKey: primaryKeys.rows.length > 0,
      };
    });
  }

  async browsePostgresRows(
    id: string,
    schema: string,
    table: string,
    page: number,
    limit: number,
    sortBy?: string,
    sortOrder: 'asc' | 'desc' = 'asc'
  ) {
    return this.withPostgresPool(id, 'query', async (pool) => {
      const metadata = await this.getPostgresTableMetadata(id, schema, table);
      const schemaSql = quoteIdent(schema);
      const tableSql = quoteIdent(table);
      const validColumns = new Set(metadata.columns.map((column) => column.name));
      const orderColumn =
        sortBy && validColumns.has(sortBy) ? sortBy : metadata.primaryKey[0] ?? metadata.columns[0]?.name;
      const orderSql = orderColumn ? `order by ${quoteIdent(orderColumn)} ${sortOrder === 'desc' ? 'desc' : 'asc'}` : '';
      const [countResult, rowsResult] = await Promise.all([
        pool.query<{ total: string }>(`select count(*)::text as total from ${schemaSql}.${tableSql}`),
        pool.query(
          `select * from ${schemaSql}.${tableSql} ${orderSql} limit $1 offset $2`,
          [limit, (page - 1) * limit]
        ),
      ]);
      return {
        metadata,
        rows: rowsResult.rows,
        total: Number(countResult.rows[0]?.total ?? 0),
        page,
        limit,
      };
    });
  }

  async insertPostgresRow(
    id: string,
    schema: string,
    table: string,
    values: Record<string, unknown>,
    userId: string
  ) {
    return this.withPostgresPool(id, 'query', async (pool) => {
      const metadata = await this.getPostgresTableMetadata(id, schema, table);
      const allowedColumns = metadata.columns.map((column) => column.name).filter((name) => name in values);
      if (allowedColumns.length === 0) {
        throw new AppError(400, 'INVALID_ROW', 'At least one column value is required');
      }

      const params = allowedColumns.map((column) => values[column]);
      const schemaSql = quoteIdent(schema);
      const tableSql = quoteIdent(table);
      const sql = `insert into ${schemaSql}.${tableSql} (${allowedColumns.map(quoteIdent).join(', ')})
        values (${allowedColumns.map((_, index) => `$${index + 1}`).join(', ')})
        returning *`;
      const result = await pool.query(sql, params);
      await this.auditService.log({
        userId,
        action: 'database.postgres.row.insert',
        resourceType: 'database',
        resourceId: id,
        details: { schema, table, columns: allowedColumns },
      });
      this.emitChange(id, 'data.updated', { provider: 'postgres', schema, table });
      return result.rows[0] ?? null;
    });
  }

  async updatePostgresRow(
    id: string,
    schema: string,
    table: string,
    primaryKey: Record<string, unknown>,
    values: Record<string, unknown>,
    userId: string
  ) {
    return this.withPostgresPool(id, 'query', async (pool) => {
      const metadata = await this.getPostgresTableMetadata(id, schema, table);
      if (!metadata.hasPrimaryKey) {
        throw new AppError(400, 'PRIMARY_KEY_REQUIRED', 'Row updates require a primary key');
      }

      const keyColumns = metadata.primaryKey;
      for (const keyColumn of keyColumns) {
        if (!(keyColumn in primaryKey)) {
          throw new AppError(400, 'PRIMARY_KEY_REQUIRED', `Missing primary key column "${keyColumn}"`);
        }
      }

      const updateColumns = metadata.columns
        .map((column) => column.name)
        .filter((column) => column in values && !keyColumns.includes(column));
      if (updateColumns.length === 0) {
        throw new AppError(400, 'INVALID_ROW', 'No editable columns provided');
      }

      const params = [...updateColumns.map((column) => values[column]), ...keyColumns.map((column) => primaryKey[column])];
      const setSql = updateColumns
        .map((column, index) => `${quoteIdent(column)} = $${index + 1}`)
        .join(', ');
      const whereSql = keyColumns
        .map((column, index) => `${quoteIdent(column)} = $${updateColumns.length + index + 1}`)
        .join(' and ');

      const result = await pool.query(
        `update ${quoteIdent(schema)}.${quoteIdent(table)}
            set ${setSql}
          where ${whereSql}
        returning *`,
        params
      );
      await this.auditService.log({
        userId,
        action: 'database.postgres.row.update',
        resourceType: 'database',
        resourceId: id,
        details: { schema, table, primaryKey: Object.keys(primaryKey), columns: updateColumns },
      });
      this.emitChange(id, 'data.updated', { provider: 'postgres', schema, table });
      return result.rows[0] ?? null;
    });
  }

  async deletePostgresRow(id: string, schema: string, table: string, primaryKey: Record<string, unknown>, userId: string) {
    return this.withPostgresPool(id, 'query', async (pool) => {
      const metadata = await this.getPostgresTableMetadata(id, schema, table);
      if (!metadata.hasPrimaryKey) {
        throw new AppError(400, 'PRIMARY_KEY_REQUIRED', 'Row deletes require a primary key');
      }
      const keyColumns = metadata.primaryKey;
      for (const keyColumn of keyColumns) {
        if (!(keyColumn in primaryKey)) {
          throw new AppError(400, 'PRIMARY_KEY_REQUIRED', `Missing primary key column "${keyColumn}"`);
        }
      }
      const params = keyColumns.map((column) => primaryKey[column]);
      const whereSql = keyColumns.map((column, index) => `${quoteIdent(column)} = $${index + 1}`).join(' and ');
      await pool.query(`delete from ${quoteIdent(schema)}.${quoteIdent(table)} where ${whereSql}`, params);
      await this.auditService.log({
        userId,
        action: 'database.postgres.row.delete',
        resourceType: 'database',
        resourceId: id,
        details: { schema, table, primaryKey: Object.keys(primaryKey) },
      });
      this.emitChange(id, 'data.updated', { provider: 'postgres', schema, table });
      return { success: true };
    });
  }

  async executePostgresSql(id: string, sqlText: string, userId: string) {
    return this.withPostgresPool(id, 'query', async (pool) => {
      const statements = splitPostgresStatements(sqlText);
      const result = await pool.query(sqlText);
      const results = (Array.isArray(result) ? result : [result]).map((entry) => ({
        command: entry.command,
        rowCount: entry.rowCount ?? 0,
        fields: entry.fields?.map((field: { name: string }) => field.name) ?? [],
        rows: entry.rows,
      }));
      const intent = inferPostgresIntent(sqlText);
      await this.auditService.log({
        userId,
        action: 'database.postgres.query',
        resourceType: 'database',
        resourceId: id,
        details: {
          intent,
          statementCount: statements.length,
          statementHash: hashPreview(sqlText),
          statementPreview: sqlText.trim().slice(0, 160),
        },
      });
      this.emitChange(id, 'query.executed', {
        provider: 'postgres',
        intent,
        statementCount: statements.length,
      });
      return { results };
    });
  }

  async scanRedisKeys(id: string, cursor: number, limit: number, search?: string, type?: string) {
    return this.withRedisClient(id, 'query', async (client) => {
      const args = [`${cursor}`];
      if (search) args.push('MATCH', search.includes('*') ? search : `*${search}*`);
      args.push('COUNT', `${limit}`);
      if (type) args.push('TYPE', type);
      const [nextCursor, keys] = (await (client as any).scan(...args)) as [string, string[]];
      const rows = await Promise.all(
        keys.map(async (key) => ({
          key,
          type: await client.type(key),
          ttlSeconds: await client.ttl(key),
        }))
      );
      return {
        cursor: Number(nextCursor),
        done: nextCursor === '0',
        keys: rows,
      };
    });
  }

  async getRedisKey(id: string, key: string) {
    return this.withRedisClient(id, 'query', async (client) => {
      const type = await client.type(key);
      if (type === 'none') throw new AppError(404, 'KEY_NOT_FOUND', 'Redis key not found');
      const ttlSeconds = await client.ttl(key);
      let value: unknown;
      switch (type) {
        case 'string':
          value = await client.get(key);
          break;
        case 'hash':
          value = await client.hgetall(key);
          break;
        case 'list':
          value = await client.lrange(key, 0, -1);
          break;
        case 'set':
          value = await client.smembers(key);
          break;
        case 'zset': {
          const pairs = await client.zrange(key, 0, -1, 'WITHSCORES');
          value = pairs.reduce<Array<{ member: string; score: number }>>((acc, item, index, list) => {
            if (index % 2 === 0) acc.push({ member: item, score: Number(list[index + 1] ?? 0) });
            return acc;
          }, []);
          break;
        }
        case 'stream':
          value = await client.xrange(key, '-', '+', 'COUNT', 200);
          break;
        default:
          value = await client.call('DUMP', key);
          break;
      }
      return { key, type, ttlSeconds, value };
    });
  }

  async setRedisKey(
    id: string,
    key: string,
    valueType: 'string' | 'hash' | 'list' | 'set' | 'zset',
    value: unknown,
    ttlSeconds: number | undefined,
    userId: string
  ) {
    return this.withRedisClient(id, 'query', async (client) => {
      const multi = client.multi();
      multi.del(key);
      switch (valueType) {
        case 'string':
          multi.set(key, String(value ?? ''));
          break;
        case 'hash':
          multi.hset(key, value as Record<string, string>);
          break;
        case 'list':
          multi.rpush(key, ...((Array.isArray(value) ? value : []).map((item) => String(item))));
          break;
        case 'set':
          multi.sadd(key, ...((Array.isArray(value) ? value : []).map((item) => String(item))));
          break;
        case 'zset': {
          const members = Array.isArray(value) ? (value as Array<{ member: string; score: number }>) : [];
          if (members.length > 0) {
            multi.zadd(
              key,
              ...members.flatMap((entry) => [`${entry.score ?? 0}`, `${entry.member ?? ''}`])
            );
          }
          break;
        }
      }
      if (ttlSeconds !== undefined && ttlSeconds >= 0) multi.expire(key, ttlSeconds);
      await multi.exec();
      await this.auditService.log({
        userId,
        action: 'database.redis.key.set',
        resourceType: 'database',
        resourceId: id,
        details: { key, type: valueType, ttlSeconds },
      });
      this.emitChange(id, 'data.updated', { provider: 'redis', key, intent: 'write' });
      return this.getRedisKey(id, key);
    });
  }

  async deleteRedisKey(id: string, key: string, userId: string) {
    return this.withRedisClient(id, 'query', async (client) => {
      await client.del(key);
      await this.auditService.log({
        userId,
        action: 'database.redis.key.delete',
        resourceType: 'database',
        resourceId: id,
        details: { key },
      });
      this.emitChange(id, 'data.updated', { provider: 'redis', key, intent: 'write' });
      return { success: true };
    });
  }

  async expireRedisKey(id: string, key: string, ttlSeconds: number, userId: string) {
    return this.withRedisClient(id, 'query', async (client) => {
      if (ttlSeconds < 0) {
        await client.persist(key);
      } else {
        await client.expire(key, ttlSeconds);
      }
      await this.auditService.log({
        userId,
        action: 'database.redis.key.expire',
        resourceType: 'database',
        resourceId: id,
        details: { key, ttlSeconds },
      });
      this.emitChange(id, 'data.updated', { provider: 'redis', key, intent: 'write' });
      return this.getRedisKey(id, key);
    });
  }

  async executeRedisCommand(id: string, commandText: string, userId: string) {
    return this.withRedisClient(id, 'query', async (client) => {
      const commands = splitRedisCommands(commandText);
      const results = [];
      const intents = new Set<'read' | 'write' | 'admin'>();
      for (const command of commands) {
        const parts = tokenizeRedisCommand(command);
        const commandName = parts[0]!.toUpperCase();
        const result = await client.call(parts[0]!, ...parts.slice(1));
        results.push({ command: commandName, result });
        intents.add(inferRedisSingleCommandIntent(command));
      }
      const intent = intents.has('admin') ? 'admin' : intents.has('write') ? 'write' : 'read';
      await this.auditService.log({
        userId,
        action: 'database.redis.command.execute',
        resourceType: 'database',
        resourceId: id,
        details: {
          intent,
          commandCount: commands.length,
          commands: results.slice(0, 5).map((entry) => entry.command),
          commandHash: hashPreview(commandText),
          commandPreview: commandText.slice(0, 160),
        },
      });
      this.emitChange(id, 'query.executed', {
        provider: 'redis',
        intent,
        commandCount: commands.length,
        commands: results.slice(0, 5).map((entry) => entry.command),
      });
      return { results };
    });
  }

  async getDecryptedConfig(id: string): Promise<DatabaseConnectionConfig> {
    const row = await this.getRow(id);
    return this.decryptConfig(row.encryptedConfig);
  }

  async listAllRows() {
    return this.db.select().from(databaseConnections).orderBy(desc(databaseConnections.updatedAt));
  }

  async updateHealth(
    id: string,
    patch: {
      status: DatabaseHealthStatus;
      responseMs?: number;
      lastError?: string | null;
      forceHistory?: boolean;
    }
  ) {
    const row = await this.getRow(id);
    const now = new Date();
    const nowIso = now.toISOString();
    const existingHistory = (row.healthHistory as DatabaseHealthEntry[] | null) ?? [];
    const lastRecordedAt =
      existingHistory.length > 0
        ? new Date(existingHistory[existingHistory.length - 1]!.ts).getTime()
        : 0;

    const shouldWriteHistory =
      patch.forceHistory ||
      row.healthStatus !== patch.status ||
      lastRecordedAt === 0 ||
      now.getTime() - lastRecordedAt >= DATABASE_HEALTH_HISTORY_MIN_INTERVAL_MS;

    const history = shouldWriteHistory
      ? this.trimHealthHistory([
          ...existingHistory,
          {
            ts: nowIso,
            status: patch.status,
            responseMs: patch.responseMs,
            slow: patch.status === 'degraded',
          },
        ])
      : existingHistory;

    const updatePayload: Partial<typeof databaseConnections.$inferInsert> = {
      healthStatus: patch.status,
      lastHealthCheckAt: now,
      lastError: patch.lastError ?? null,
      updatedAt: now,
    };
    if (shouldWriteHistory) updatePayload.healthHistory = history;

    await this.db.update(databaseConnections).set(updatePayload).where(eq(databaseConnections.id, id));
    if (shouldWriteHistory) {
      this.emitChange(id, 'health.sampled', {
        name: row.name,
        type: row.type,
        healthStatus: patch.status,
        sampledAt: nowIso,
      });
    }
    if (row.healthStatus !== patch.status) {
      const action = patch.status === 'online' ? 'health.online' : patch.status === 'degraded' ? 'health.degraded' : 'health.offline';
      this.emitChange(id, action, { name: row.name, type: row.type, healthStatus: patch.status, sampledAt: nowIso });
    }
  }

  private async getRow(id: string) {
    const row = await this.db.query.databaseConnections.findFirst({
      where: eq(databaseConnections.id, id),
    });
    if (!row) throw new AppError(404, 'DATABASE_NOT_FOUND', 'Database connection not found');
    return row;
  }

  private emitChange(id: string, action: string, extra: Record<string, unknown> = {}) {
    this.eventBus?.publish('database.changed', { id, action, ...extra });
  }

  private encryptConfig(config: DatabaseConnectionConfig): string {
    return JSON.stringify(this.cryptoService.encryptString(JSON.stringify(config)));
  }

  private decryptConfig(encryptedConfig: string): DatabaseConnectionConfig {
    const parsed = JSON.parse(encryptedConfig) as { encryptedKey: string; encryptedDek: string };
    return JSON.parse(this.cryptoService.decryptString(parsed)) as DatabaseConnectionConfig;
  }

  private toView(
    row: typeof databaseConnections.$inferSelect,
    config: DatabaseConnectionConfig,
    revealCredentials: boolean
  ): DatabaseConnectionView {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      description: row.description,
      tags: (row.tags as string[] | null) ?? [],
      manualSizeLimitMb: row.manualSizeLimitMb,
      host: row.host,
      port: row.port,
      databaseName: row.databaseName,
      username: row.username,
      tlsEnabled: row.tlsEnabled,
      healthStatus: row.healthStatus,
      lastHealthCheckAt: row.lastHealthCheckAt?.toISOString() ?? null,
      lastError: row.lastError,
      healthHistory: (row.healthHistory as DatabaseHealthEntry[] | null) ?? [],
      hasStoredPassword: !!config.password,
      config:
        config.type === 'postgres'
          ? {
              host: config.host,
              port: config.port,
              database: config.database,
              username: config.username,
              password: revealCredentials ? config.password : maskValue(config.password),
              sslEnabled: config.sslEnabled,
            }
          : {
              host: config.host,
              port: config.port,
              username: config.username,
              password: revealCredentials ? config.password : maskValue(config.password),
              db: config.db,
              tlsEnabled: config.tlsEnabled,
            },
      createdById: row.createdById,
      updatedById: row.updatedById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private normalizePostgres(
    config: Partial<PostgresConnectionConfig> & {
      connectionString?: string;
      database?: string;
      sslEnabled?: boolean;
    }
  ): PostgresConnectionConfig {
    let host = config.host?.trim();
    let port = config.port;
    let database = config.database?.trim();
    let username = config.username?.trim();
    let password = config.password ?? '';
    let sslEnabled = config.sslEnabled ?? false;

    if (config.connectionString) {
      const url = new URL(config.connectionString);
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
        throw new AppError(400, 'INVALID_CONNECTION_STRING', 'Invalid Postgres connection string');
      }
      host = host ?? url.hostname;
      port = port ?? Number(url.port || 5432);
      database = database ?? decodeURIComponent(url.pathname.replace(/^\//, ''));
      username = username ?? decodeURIComponent(url.username);
      password = config.password ?? decodeURIComponent(url.password);
      sslEnabled = config.sslEnabled ?? ['require', 'verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '');
    }

    if (!host || !port || !database || !username) {
      throw new AppError(400, 'INVALID_DATABASE_CONFIG', 'Postgres connections require host, port, database, username, and password');
    }
    if (password === undefined || password === null) {
      throw new AppError(400, 'INVALID_DATABASE_CONFIG', 'Postgres password is required');
    }

    return {
      type: 'postgres',
      host,
      port,
      database,
      username,
      password,
      sslEnabled,
    };
  }

  private normalizeRedis(
    config: Partial<RedisConnectionConfig> & {
      connectionString?: string;
      db?: number;
      tlsEnabled?: boolean;
    }
  ): RedisConnectionConfig {
    let host = config.host?.trim();
    let port = config.port;
    let username = config.username?.trim() ?? null;
    let password = config.password ?? '';
    let db = config.db ?? 0;
    let tlsEnabled = config.tlsEnabled ?? false;

    if (config.connectionString) {
      const url = new URL(config.connectionString);
      if (!['redis:', 'rediss:'].includes(url.protocol)) {
        throw new AppError(400, 'INVALID_CONNECTION_STRING', 'Invalid Redis connection string');
      }
      host = host ?? url.hostname;
      port = port ?? Number(url.port || 6379);
      username = config.username ?? (url.username ? decodeURIComponent(url.username) : null);
      password = config.password ?? decodeURIComponent(url.password);
      db = config.db ?? Number(url.pathname.replace(/^\//, '') || 0);
      tlsEnabled = config.tlsEnabled ?? url.protocol === 'rediss:';
    }

    if (!host || !port) {
      throw new AppError(400, 'INVALID_DATABASE_CONFIG', 'Redis connections require host and port');
    }
    if (password === undefined || password === null) {
      throw new AppError(400, 'INVALID_DATABASE_CONFIG', 'Redis password is required');
    }

    return {
      type: 'redis',
      host,
      port,
      username,
      password,
      db,
      tlsEnabled,
    };
  }

  private async testNormalizedConnection(config: DatabaseConnectionConfig): Promise<{ status: DatabaseHealthStatus; responseMs: number }> {
    const started = Date.now();
    if (config.type === 'postgres') {
      const pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.username,
        password: config.password,
        max: 1,
        idleTimeoutMillis: 5000,
        connectionTimeoutMillis: 10_000,
        ssl: config.sslEnabled ? { rejectUnauthorized: false } : undefined,
      });
      try {
        await pool.query('select 1');
      } catch (error) {
        this.rethrowDatabaseError(error, 'postgres', 'connect');
      } finally {
        await pool.end().catch(() => {});
      }
    } else {
      const client = new Redis({
        host: config.host,
        port: config.port,
        username: config.username ?? undefined,
        password: config.password,
        db: config.db,
        lazyConnect: true,
        connectTimeout: 10_000,
        tls: config.tlsEnabled ? { rejectUnauthorized: false } : undefined,
      });
      try {
        await client.connect();
        await client.ping();
      } catch (error) {
        this.rethrowDatabaseError(error, 'redis', 'connect');
      } finally {
        await client.quit().catch(() => client.disconnect());
      }
    }
    const responseMs = Date.now() - started;
    return { status: responseMs >= 1_000 ? 'degraded' : 'online', responseMs };
  }

  private buildConnectionString(config: DatabaseConnectionConfig): string {
    if (config.type === 'postgres') {
      const protocol = 'postgresql';
      const sslMode = config.sslEnabled ? '?sslmode=require' : '';
      return `${protocol}://${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}@${config.host}:${config.port}/${encodeURIComponent(config.database)}${sslMode}`;
    }
    const protocol = config.tlsEnabled ? 'rediss' : 'redis';
    const auth = config.username ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password)}` : `:${encodeURIComponent(config.password)}`;
    return `${protocol}://${auth}@${config.host}:${config.port}/${config.db}`;
  }

  async getPostgresPool(id: string): Promise<pg.Pool> {
    const existing = this.postgresPools.get(id);
    if (existing) return existing;
    const config = await this.getDecryptedConfig(id);
    if (config.type !== 'postgres') throw new AppError(400, 'INVALID_PROVIDER', 'Database is not Postgres');
    const pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.username,
      password: config.password,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      ssl: config.sslEnabled ? { rejectUnauthorized: false } : undefined,
    });
    try {
      await pool.query('select 1');
    } catch (error) {
      await pool.end().catch(() => {});
      this.rethrowDatabaseError(error, 'postgres', 'connect');
    }
    this.postgresPools.set(id, pool);
    return pool;
  }

  async getRedisClient(id: string): Promise<Redis> {
    const existing = this.redisClients.get(id);
    if (existing) return existing;
    const config = await this.getDecryptedConfig(id);
    if (config.type !== 'redis') throw new AppError(400, 'INVALID_PROVIDER', 'Database is not Redis');
    const client = new Redis({
      host: config.host,
      port: config.port,
      username: config.username ?? undefined,
      password: config.password,
      db: config.db,
      lazyConnect: true,
      connectTimeout: 15_000,
      maxRetriesPerRequest: 2,
      tls: config.tlsEnabled ? { rejectUnauthorized: false } : undefined,
    });
    try {
      await client.connect();
    } catch (error) {
      client.disconnect();
      this.rethrowDatabaseError(error, 'redis', 'connect');
    }
    this.redisClients.set(id, client);
    return client;
  }

  async disposeClient(id: string): Promise<void> {
    const pool = this.postgresPools.get(id);
    if (pool) {
      this.postgresPools.delete(id);
      await pool.end().catch(() => {});
    }
    const redisClient = this.redisClients.get(id);
    if (redisClient) {
      this.redisClients.delete(id);
      await redisClient.quit().catch(() => redisClient.disconnect());
    }
  }

  private async withPostgresPool<T>(
    id: string,
    operation: DatabaseOperation,
    run: (pool: pg.Pool) => Promise<T>
  ): Promise<T> {
    const pool = await this.getPostgresPool(id);
    try {
      return await run(pool);
    } catch (error) {
      this.rethrowDatabaseError(error, 'postgres', operation);
    }
  }

  private async withRedisClient<T>(
    id: string,
    operation: DatabaseOperation,
    run: (client: Redis) => Promise<T>
  ): Promise<T> {
    const client = await this.getRedisClient(id);
    try {
      return await run(client);
    } catch (error) {
      this.rethrowDatabaseError(error, 'redis', operation);
    }
  }

  private rethrowDatabaseError(error: unknown, provider: DatabaseType, operation: DatabaseOperation): never {
    const mapped = mapDatabaseDriverError(error, provider, operation);
    if (mapped) throw mapped;
    throw error;
  }

  private trimHealthHistory(history: DatabaseHealthEntry[]): DatabaseHealthEntry[] {
    const cutoff = Date.now() - DATABASE_HEALTH_HISTORY_MAX_AGE_MS;
    return history.filter((entry) => new Date(entry.ts).getTime() >= cutoff);
  }
}
