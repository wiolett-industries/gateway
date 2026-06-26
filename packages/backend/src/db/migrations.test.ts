import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function readMigrationJournal(): JournalEntry[] {
  const raw = readFileSync(join(process.cwd(), 'src/db/migrations/meta/_journal.json'), 'utf8');
  const parsed = JSON.parse(raw) as { entries: JournalEntry[] };
  return parsed.entries;
}

describe('drizzle migration metadata', () => {
  it('keeps journal entries monotonic and backed by SQL files', () => {
    const entries = readMigrationJournal();

    for (const [index, entry] of entries.entries()) {
      expect(entry.idx).toBe(index);
      expect(existsSync(join(process.cwd(), 'src/db/migrations', `${entry.tag}.sql`))).toBe(true);

      const previous = entries[index - 1];
      if (previous) {
        expect(entry.when).toBeGreaterThan(previous.when);
      }
    }
  });
});
