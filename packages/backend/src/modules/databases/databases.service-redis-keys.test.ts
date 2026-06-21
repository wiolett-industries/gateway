import { describe, expect, it, vi } from 'vitest';
import { DatabaseConnectionService } from './databases.service.js';

function createService() {
  const log = vi.fn().mockResolvedValue(undefined);
  const service = new DatabaseConnectionService({} as never, { log } as never, {} as never);
  return { log, service };
}

describe('DatabaseConnectionService Redis key operations', () => {
  it('reads string keys with bounded byte pagination metadata', async () => {
    const { service } = createService();
    const client = {
      type: vi.fn().mockResolvedValue('string'),
      ttl: vi.fn().mockResolvedValue(60),
      strlen: vi.fn().mockResolvedValue(10),
      getrange: vi.fn().mockResolvedValue('hello'),
    };
    vi.spyOn(service, 'getRedisClient').mockResolvedValue(client as never);

    await expect(service.getRedisKey('db-1', 'message', { maxStringBytes: 5 })).resolves.toEqual({
      key: 'message',
      type: 'string',
      ttlSeconds: 60,
      value: 'hello',
      page: { offset: 0, limit: 5, returned: 5, total: 10, truncated: true },
    });
    expect(client.getrange).toHaveBeenCalledWith('message', 0, 4);
  });

  it('reads sorted sets as member score objects', async () => {
    const { service } = createService();
    const client = {
      type: vi.fn().mockResolvedValue('zset'),
      ttl: vi.fn().mockResolvedValue(-1),
      zrange: vi.fn().mockResolvedValue(['alice', '10', 'bob', '20']),
      zcard: vi.fn().mockResolvedValue(2),
    };
    vi.spyOn(service, 'getRedisClient').mockResolvedValue(client as never);

    await expect(service.getRedisKey('db-1', 'leaderboard', { offset: 1, limit: 2 })).resolves.toEqual({
      key: 'leaderboard',
      type: 'zset',
      ttlSeconds: -1,
      value: [
        { member: 'alice', score: 10 },
        { member: 'bob', score: 20 },
      ],
      page: { offset: 1, limit: 2, returned: 2, total: 2, truncated: false },
    });
    expect(client.zrange).toHaveBeenCalledWith('leaderboard', 1, 2, 'WITHSCORES');
  });

  it('writes zset keys through Redis multi and returns the refreshed key', async () => {
    const { log, service } = createService();
    const multi = {
      del: vi.fn(),
      zadd: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    };
    const client = {
      multi: vi.fn().mockReturnValue(multi),
    };
    vi.spyOn(service, 'getRedisClient').mockResolvedValue(client as never);
    vi.spyOn(service, 'getRedisKey').mockResolvedValue({
      key: 'leaderboard',
      type: 'zset',
      ttlSeconds: 120,
      value: [{ member: 'alice', score: 10 }],
      page: { offset: 0, limit: 100, returned: 1, total: 1 },
    });

    await expect(
      service.setRedisKey('db-1', 'leaderboard', 'zset', [{ member: 'alice', score: 10 }], 120, 'user-1')
    ).resolves.toMatchObject({ key: 'leaderboard', type: 'zset' });
    expect(multi.del).toHaveBeenCalledWith('leaderboard');
    expect(multi.zadd).toHaveBeenCalledWith('leaderboard', '10', 'alice');
    expect(multi.expire).toHaveBeenCalledWith('leaderboard', 120);
    expect(multi.exec).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: 'database.redis.key.set' }));
  });
});
