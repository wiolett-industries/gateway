import type Redis from 'ioredis';
import { AppError } from '@/middleware/error-handler.js';
import { compactForJsonBudget, REDIS_COMMAND_MAX_BYTES, truncateUtf8 } from './database-result-compaction.js';

export type RedisKeyValueType = 'string' | 'hash' | 'list' | 'set' | 'zset';

export async function scanRedisKeys(client: Redis, cursor: number, limit: number, search?: string, type?: string) {
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
}

export async function getRedisKey(
  client: Redis,
  key: string,
  options: { offset?: number; limit?: number; maxStringBytes?: number } = {}
) {
  const offset = Math.max(Math.trunc(options.offset ?? 0), 0);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const maxStringBytes = Math.min(Math.max(Math.trunc(options.maxStringBytes ?? 64 * 1024), 1), 1024 * 1024);
  const type = await client.type(key);
  if (type === 'none') throw new AppError(404, 'KEY_NOT_FOUND', 'Redis key not found');
  const ttlSeconds = await client.ttl(key);
  let value: unknown;
  let page: Record<string, unknown> | undefined;
  switch (type) {
    case 'string': {
      const total = await client.strlen(key);
      const raw = (await client.getrange(key, offset, offset + maxStringBytes - 1)) ?? '';
      const truncated = truncateUtf8(raw, maxStringBytes);
      value = truncated.value;
      page = {
        offset,
        limit: maxStringBytes,
        returned: Buffer.byteLength(truncated.value, 'utf8'),
        total,
        truncated: truncated.truncated || offset + Buffer.byteLength(truncated.value, 'utf8') < total,
      };
      break;
    }
    case 'hash': {
      const [cursor, entries] = (await client.hscan(key, String(offset), 'COUNT', limit)) as [string, string[]];
      value = Object.fromEntries(
        Array.from({ length: Math.floor(entries.length / 2) }, (_, index) => [
          entries[index * 2]!,
          entries[index * 2 + 1]!,
        ])
      );
      page = { cursor: Number(cursor), limit, returned: entries.length / 2, total: await client.hlen(key) };
      break;
    }
    case 'list':
      value = await client.lrange(key, offset, offset + limit - 1);
      page = { offset, limit, returned: Array.isArray(value) ? value.length : 0, total: await client.llen(key) };
      break;
    case 'set': {
      const [cursor, members] = (await client.sscan(key, String(offset), 'COUNT', limit)) as [string, string[]];
      value = members;
      page = { cursor: Number(cursor), limit, returned: members.length, total: await client.scard(key) };
      break;
    }
    case 'zset': {
      const pairs = await client.zrange(key, offset, offset + limit - 1, 'WITHSCORES');
      value = pairs.reduce<Array<{ member: string; score: number }>>((acc, item, index, list) => {
        if (index % 2 === 0) acc.push({ member: item, score: Number(list[index + 1] ?? 0) });
        return acc;
      }, []);
      page = {
        offset,
        limit,
        returned: Array.isArray(value) ? value.length : 0,
        total: await client.zcard(key),
      };
      break;
    }
    case 'stream':
      value = await client.xrange(key, '-', '+', 'COUNT', limit);
      page = { offset: 0, limit, returned: Array.isArray(value) ? value.length : 0 };
      break;
    default:
      value = await client.call('DUMP', key);
      break;
  }
  if (type !== 'string') {
    const compacted = compactForJsonBudget(value, REDIS_COMMAND_MAX_BYTES);
    value = compacted.value;
    page = { ...(page ?? {}), truncated: Boolean(page?.truncated) || compacted.truncated };
  }
  return { key, type, ttlSeconds, value, page };
}

export async function setRedisKey(
  client: Redis,
  key: string,
  valueType: RedisKeyValueType,
  value: unknown,
  ttlSeconds: number | undefined
) {
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
      multi.rpush(key, ...(Array.isArray(value) ? value : []).map((item) => String(item)));
      break;
    case 'set':
      multi.sadd(key, ...(Array.isArray(value) ? value : []).map((item) => String(item)));
      break;
    case 'zset': {
      const members = Array.isArray(value) ? (value as Array<{ member: string; score: number }>) : [];
      if (members.length > 0) {
        multi.zadd(key, ...members.flatMap((entry) => [`${entry.score ?? 0}`, `${entry.member ?? ''}`]));
      }
      break;
    }
  }
  if (ttlSeconds !== undefined && ttlSeconds >= 0) multi.expire(key, ttlSeconds);
  await multi.exec();
}
