import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/middleware/error-handler.js';
import {
  DatabaseConnectionService,
  inferPostgresIntent,
  inferRedisIntent,
  mapDatabaseDriverError,
} from './databases.service.js';

describe('mapDatabaseDriverError', () => {
  it('maps postgres authentication failures to 401', () => {
    const error = Object.assign(new Error('password authentication failed for user "doadmin"'), {
      code: '28P01',
    });
    const mapped = mapDatabaseDriverError(error, 'postgres', 'connect');

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(401);
    expect(mapped?.code).toBe('DATABASE_AUTH_FAILED');
  });

  it('maps redis authentication failures to 401', () => {
    const error = new Error('WRONGPASS invalid username-password pair or user is disabled.');
    const mapped = mapDatabaseDriverError(error, 'redis', 'connect');

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(401);
    expect(mapped?.code).toBe('DATABASE_AUTH_FAILED');
  });

  it('maps network and connectivity failures to 422', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    const mapped = mapDatabaseDriverError(error, 'postgres', 'connect');

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(422);
    expect(mapped?.code).toBe('DATABASE_CONNECTION_FAILED');
  });

  it('maps postgres query syntax errors to 400', () => {
    const error = Object.assign(new Error('syntax error at or near "FROM"'), {
      code: '42601',
    });
    const mapped = mapDatabaseDriverError(error, 'postgres', 'query');

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(400);
    expect(mapped?.code).toBe('DATABASE_QUERY_FAILED');
  });

  it('maps other postgres query driver errors to 400 so the UI sees the real message', () => {
    const error = Object.assign(new Error('invalid input value for enum order_status: "oops"'), {
      code: 'ZZZZZ',
      severity: 'ERROR',
    });
    const mapped = mapDatabaseDriverError(error, 'postgres', 'query');

    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(400);
    expect(mapped?.code).toBe('DATABASE_QUERY_FAILED');
    expect(mapped?.message).toContain('invalid input value for enum');
  });

  it('does not remap operational postgres query failures as client query errors', () => {
    const error = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
      severity: 'FATAL',
    });
    const mapped = mapDatabaseDriverError(error, 'postgres', 'query');

    expect(mapped).toBeNull();
  });

  it('returns null for unknown errors', () => {
    const mapped = mapDatabaseDriverError(new Error('unexpected socket blowup'), 'postgres', 'connect');
    expect(mapped).toBeNull();
  });
});

describe('database query intent inference', () => {
  it('infers the strongest Postgres intent across batches while ignoring quoted semicolons', () => {
    expect(inferPostgresIntent("select ';' as semi; show all")).toBe('read');
    expect(inferPostgresIntent('select * from users; update users set role = $1')).toBe('write');
    expect(inferPostgresIntent('with deleted as (delete from users returning *) select * from deleted')).toBe('admin');
  });

  it('infers the strongest Redis command intent across quoted and batched commands', () => {
    expect(inferRedisIntent('GET "key;with;semicolons"; TTL key')).toBe('read');
    expect(inferRedisIntent('GET key\nSET key value')).toBe('write');
    expect(inferRedisIntent('CONFIG GET *')).toBe('admin');
  });
});

describe('DatabaseConnectionService.executePostgresSql', () => {
  it('rejects Postgres SQL batches above the response result limit before executing any statement', async () => {
    const service = new DatabaseConnectionService({} as never, { log: vi.fn() } as never, {} as never);
    const pool = {
      connect: vi.fn(),
    };
    const getPostgresPool = vi.spyOn(service, 'getPostgresPool').mockResolvedValue(pool as never);

    const sql = Array.from({ length: 11 }, (_, index) => `select ${index}`).join('; ');

    await expect(service.executePostgresSql('db-1', sql, 'user-1')).rejects.toMatchObject({
      statusCode: 400,
      code: 'POSTGRES_STATEMENT_LIMIT_EXCEEDED',
    });
    expect(getPostgresPool).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('casts update row parameters using column metadata types', async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const service = new DatabaseConnectionService({} as never, { log } as never, {} as never);
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: '1' }] }),
    };
    vi.spyOn(service, 'getPostgresPool').mockResolvedValue(pool as never);
    vi.spyOn(service, 'getPostgresTableMetadata').mockResolvedValue({
      schema: 'public',
      table: 'orders',
      columns: [
        {
          name: 'id',
          dataType: 'bigint',
          udtName: 'int8',
          udtSchema: 'pg_catalog',
          nullable: false,
          isPrimaryKey: true,
          hasDefault: false,
        },
        {
          name: 'status',
          dataType: 'USER-DEFINED',
          udtName: 'order_status',
          udtSchema: 'public',
          nullable: false,
          isPrimaryKey: false,
          hasDefault: false,
        },
        {
          name: 'scheduled_for',
          dataType: 'date',
          udtName: 'date',
          udtSchema: 'pg_catalog',
          nullable: true,
          isPrimaryKey: false,
          hasDefault: false,
        },
        {
          name: 'attempts',
          dataType: 'smallint',
          udtName: 'int2',
          udtSchema: 'pg_catalog',
          nullable: false,
          isPrimaryKey: false,
          hasDefault: false,
        },
      ],
      primaryKey: ['id'],
      hasPrimaryKey: true,
    });

    await service.updatePostgresRow(
      'db-1',
      'public',
      'orders',
      { id: '1' },
      { id: '1', status: 'queued', scheduled_for: '2026-06-18', attempts: '2' },
      'user-1'
    );

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'set "status" = $1::"public"."order_status", "scheduled_for" = $2::date, "attempts" = $3::smallint'
      ),
      ['queued', '2026-06-18', '2', '1']
    );
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('where "id" = $4::bigint'), [
      'queued',
      '2026-06-18',
      '2',
      '1',
    ]);
    expect(log).toHaveBeenCalled();
  });

  it('compacts Postgres query rows to the requested maxRows and reports truncation', async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const service = new DatabaseConnectionService({} as never, { log } as never, {} as never);
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SET') || sql.startsWith('RESET')) return {};
        return {
          command: 'SELECT',
          rowCount: 3,
          fields: [{ name: 'id' }, { name: 'payload' }],
          rows: [
            { id: 1, payload: 'a' },
            { id: 2, payload: 'b' },
            { id: 3, payload: 'c' },
          ],
        };
      }),
      release: vi.fn(),
    };
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    };
    vi.spyOn(service, 'getPostgresPool').mockResolvedValue(pool as never);

    await expect(service.executePostgresSql('db-1', 'select * from events', 'user-1', { maxRows: 2 })).resolves.toEqual(
      {
        results: [
          expect.objectContaining({
            command: 'SELECT',
            rowCount: 3,
            fields: ['id', 'payload'],
            rows: [
              { id: 1, payload: 'a' },
              { id: 2, payload: 'b' },
            ],
            truncated: true,
            maxRows: 2,
          }),
        ],
        truncated: false,
        resultLimit: 10,
      }
    );
    expect(client.release).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'database.postgres.query' }));
  });
});

describe('DatabaseConnectionService.executeRedisCommand', () => {
  it('compacts oversized Redis command results before returning them', async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const service = new DatabaseConnectionService({} as never, { log } as never, {} as never);
    const client = {
      call: vi.fn().mockResolvedValue(Array.from({ length: 600 }, (_, index) => `item-${index}`)),
    };
    vi.spyOn(service, 'getRedisClient').mockResolvedValue(client as never);

    await expect(service.executeRedisCommand('db-1', 'LRANGE queue 0 -1', 'user-1')).resolves.toEqual({
      results: [
        {
          command: 'LRANGE',
          result: Array.from({ length: 500 }, (_, index) => `item-${index}`),
          truncated: true,
        },
      ],
      truncated: false,
      commandLimit: 20,
    });
    expect(client.call).toHaveBeenCalledWith('LRANGE', 'queue', '0', '-1');
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'database.redis.command.execute' }));
  });
});

describe('DatabaseConnectionService connection views', () => {
  function encryptedConfig(config: Record<string, unknown>) {
    return JSON.stringify({ payload: JSON.stringify(config) });
  }

  function createService(row: Record<string, unknown>) {
    const db = {
      query: {
        databaseConnections: {
          findFirst: vi.fn().mockResolvedValue(row),
        },
      },
    };
    const cryptoService = {
      decryptString: vi.fn((payload: { payload: string }) => payload.payload),
      encryptString: vi.fn((value: string) => ({ payload: value })),
    };
    return new DatabaseConnectionService(db as never, { log: vi.fn() } as never, cryptoService as never);
  }

  it('masks stored database credentials in normal connection views', async () => {
    const service = createService({
      id: 'db-1',
      name: 'Production Postgres',
      type: 'postgres',
      description: null,
      tags: ['prod'],
      manualSizeLimitMb: 1024,
      host: 'db.example.com',
      port: 5432,
      databaseName: 'app',
      username: 'app_user',
      tlsEnabled: true,
      encryptedConfig: encryptedConfig({
        type: 'postgres',
        host: 'db.example.com',
        port: 5432,
        database: 'app',
        username: 'app_user',
        password: 'secret-password',
        sslEnabled: true,
      }),
      healthStatus: 'online',
      lastHealthCheckAt: new Date('2026-06-21T10:00:00.000Z'),
      lastError: null,
      healthHistory: null,
      createdById: 'user-1',
      updatedById: null,
      createdAt: new Date('2026-06-20T10:00:00.000Z'),
      updatedAt: new Date('2026-06-21T10:00:00.000Z'),
    });

    await expect(service.get('db-1')).resolves.toMatchObject({
      id: 'db-1',
      hasStoredPassword: true,
      config: {
        password: '••••••••',
        sslEnabled: true,
      },
    });
  });

  it('reveals credentials with an encoded Postgres connection string', async () => {
    const service = createService({
      id: 'db-1',
      name: 'Production Postgres',
      type: 'postgres',
      description: null,
      tags: [],
      manualSizeLimitMb: null,
      host: 'db.example.com',
      port: 5432,
      databaseName: 'app db',
      username: 'app user',
      tlsEnabled: true,
      encryptedConfig: encryptedConfig({
        type: 'postgres',
        host: 'db.example.com',
        port: 5432,
        database: 'app db',
        username: 'app user',
        password: 'p@ss word',
        sslEnabled: true,
      }),
      healthStatus: 'online',
      lastHealthCheckAt: null,
      lastError: null,
      healthHistory: [],
      createdById: 'user-1',
      updatedById: null,
      createdAt: new Date('2026-06-20T10:00:00.000Z'),
      updatedAt: new Date('2026-06-21T10:00:00.000Z'),
    });

    await expect(service.revealCredentials('db-1')).resolves.toMatchObject({
      password: 'p@ss word',
      connectionString: 'postgresql://app%20user:p%40ss%20word@db.example.com:5432/app%20db?sslmode=require',
    });
  });
});
