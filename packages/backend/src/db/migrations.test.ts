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

  it('keeps the AI search payload purge scoped to unsafe derived documents', () => {
    const migration = readFileSync(
      join(process.cwd(), 'src/db/migrations/0053_ai_search_tool_payload_reset.sql'),
      'utf8'
    );

    expect(migration).toContain('"kind" IN');
    expect(migration).toContain("'tool_call'");
    expect(migration).toContain("'tool_result'");
    expect(migration).toContain("'window'");
    expect(migration).toContain('"role" = \'tool\'');
    expect(migration).not.toMatch(/DELETE FROM "ai_conversation_search_documents"\s*;$/m);
  });
});
