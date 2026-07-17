import { describe, expect, it } from 'vitest';
import {
  isMatchingUniqueConstraintViolation,
  resourceSlugBase,
  resourceSlugCandidate,
  writeWithAllocatedSlug,
} from './resource-slugs.js';

const CONSTRAINT = 'resources_slug_unique';
const duplicate = (constraint = CONSTRAINT) => Object.assign(new Error('duplicate'), { code: '23505', constraint });

describe('resource slugs', () => {
  it.each([
    ['Café Ștefan', 'resource', 'cafe-stefan'],
    ['Ёж Йогурт', 'resource', 'yozh-yogurt'],
    ['İstanbul', 'resource', 'istanbul'],
    ['東京', 'node', 'node'],
    ['   ', 'proxy-host', 'proxy-host'],
  ])('normalizes %s', (source, fallback, expected) => {
    expect(resourceSlugBase(source, fallback)).toBe(expected);
  });

  it('limits the base before adding the collision suffix', () => {
    const base = resourceSlugBase('A'.repeat(80), 'node');
    expect(base).toHaveLength(60);
    expect(resourceSlugCandidate(base, 12)).toBe(`${'a'.repeat(57)}-12`);
  });

  it('retries matching unique violations and starts reserved names with a suffix', async () => {
    const attempts: string[] = [];
    const result = await writeWithAllocatedSlug({
      source: 'file',
      fallback: 'node',
      reserved: ['file', 'console'],
      constraint: CONSTRAINT,
      write: async (slug) => {
        attempts.push(slug);
        if (attempts.length < 2) throw duplicate();
        return slug;
      },
    });
    expect(attempts).toEqual(['file-1', 'file-2']);
    expect(result).toBe('file-2');
  });

  it('propagates an unrelated unique violation, including through Drizzle causes', async () => {
    const unrelated = new Error('Failed query', { cause: duplicate('other_constraint') });
    expect(isMatchingUniqueConstraintViolation(unrelated, CONSTRAINT)).toBe(false);
    await expect(
      writeWithAllocatedSlug({
        source: 'Example',
        fallback: 'resource',
        constraint: CONSTRAINT,
        write: async () => {
          throw unrelated;
        },
      })
    ).rejects.toBe(unrelated);
  });

  it('handles natural suffix collisions without a preflight query', async () => {
    const committed = new Set<string>();
    const allocate = (source: string) =>
      writeWithAllocatedSlug({
        source,
        fallback: 'node',
        constraint: CONSTRAINT,
        write: async (slug) => {
          if (committed.has(slug)) throw duplicate();
          committed.add(slug);
          return slug;
        },
      });

    expect([await allocate('Node'), await allocate('Node'), await allocate('Node 1')]).toEqual([
      'node',
      'node-1',
      'node-1-1',
    ]);
  });
});
