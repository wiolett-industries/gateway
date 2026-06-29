import { describe, expect, it } from 'vitest';
import { normalizeSearchText, relaxedTokenWindows, trigramSimilarity } from './ai-conversation-search-normalizer.js';

describe('AI conversation search normalization', () => {
  it('normalizes language-neutral text and splits code identifiers', () => {
    expect(normalizeSearchText('Failed query: ai_runs.clientCommandId / download_artifact')).toEqual({
      normalizedText: 'failed query ai runs client command id download artifact',
      tokens: ['failed', 'query', 'ai', 'runs', 'client', 'command', 'id', 'download', 'artifact'],
    });
  });

  it('keeps unicode text without language-specific folding', () => {
    const result = normalizeSearchText('Проект: миграция чата');

    expect(result.normalizedText).toBe('проект миграция чата');
    expect(result.tokens).toEqual(['проект', 'миграция', 'чата']);
  });

  it('builds deterministic relaxed token windows', () => {
    expect(relaxedTokenWindows(['one', 'two', 'three', 'four'])).toEqual([
      ['one', 'two', 'three', 'four'],
      ['one', 'two', 'three'],
      ['one', 'two'],
      ['two', 'three', 'four'],
      ['two', 'three'],
      ['three', 'four'],
    ]);
  });

  it('scores fuzzy strings with deterministic trigrams', () => {
    expect(trigramSimilarity('client_command_id', 'client command id')).toBeGreaterThan(0.6);
    expect(trigramSimilarity('client_command_id', 'totally unrelated')).toBeLessThan(0.2);
  });
});
