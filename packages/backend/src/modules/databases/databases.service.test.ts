import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/middleware/error-handler.js';
import { DatabaseConnectionService, mapDatabaseDriverError } from './databases.service.js';

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
});
