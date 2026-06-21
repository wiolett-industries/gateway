import { describe, expect, it, vi } from 'vitest';
import { DatabaseConnectionService } from './databases.service.js';

function createService() {
  const log = vi.fn().mockResolvedValue(undefined);
  const service = new DatabaseConnectionService({} as never, { log } as never, {} as never);
  return { log, service };
}

function mockPostgresPool(service: DatabaseConnectionService, tableType = 'BASE TABLE') {
  const pool = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return { rows: tableType ? [{ table_type: tableType }] : [] };
      }
      return { rows: [] };
    }),
  };
  vi.spyOn(service, 'getPostgresPool').mockResolvedValue(pool as never);
  return pool;
}

const tableMetadata = {
  schema: 'public',
  table: 'events',
  columns: [
    {
      name: 'id',
      dataType: 'integer',
      udtName: 'int4',
      udtSchema: 'pg_catalog',
      nullable: false,
      isPrimaryKey: true,
      hasDefault: false,
    },
    {
      name: 'created_at',
      dataType: 'timestamp',
      udtName: 'timestamp',
      udtSchema: 'pg_catalog',
      nullable: false,
      isPrimaryKey: false,
      hasDefault: false,
    },
  ],
  primaryKey: ['id'],
  hasPrimaryKey: true,
};

describe('DatabaseConnectionService PostgreSQL column operations', () => {
  it('normalizes supported column types before adding or changing columns', async () => {
    const { log, service } = createService();
    const pool = mockPostgresPool(service);
    vi.spyOn(service, 'getPostgresTableMetadata').mockResolvedValue(tableMetadata);

    await service.addPostgresColumn(
      'db-1',
      'public',
      'events',
      'event_time',
      '  TIMESTAMP   WITH   TIME ZONE ',
      'user-1'
    );
    expect(pool.query).toHaveBeenCalledWith(
      'alter table "public"."events" add column "event_time" timestamp with time zone'
    );

    await service.updatePostgresColumnType('db-1', 'public', 'events', 'created_at', ' VARCHAR(1024) ', 'user-1');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('type varchar(1024)'));
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('using "created_at"::varchar(1024)'));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'database.postgres.column.add' }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'database.postgres.column.type.update' }));
  });

  it('rejects unsupported types and non-base tables before altering columns', async () => {
    const { service } = createService();
    const invalidPool = mockPostgresPool(service);

    await expect(
      service.addPostgresColumn('db-1', 'public', 'events', 'payload', 'varchar(999)', 'user-1')
    ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_COLUMN_TYPE' });
    expect(invalidPool.query).not.toHaveBeenCalled();

    vi.restoreAllMocks();
    const { service: viewService } = createService();
    const viewPool = mockPostgresPool(viewService, 'VIEW');
    await expect(
      viewService.deletePostgresColumn('db-1', 'public', 'events_view', 'created_at', 'user-1')
    ).rejects.toMatchObject({ statusCode: 400, code: 'VIEW_NOT_EDITABLE' });
    expect(viewPool.query).toHaveBeenCalledTimes(1);
  });
});
