import { describe, expect, it, vi } from 'vitest';
import { AIConversationSearchService } from './ai-conversation-search.service.js';

describe('AIConversationSearchService best-effort indexing', () => {
  it('does not throw when a lifecycle index rebuild fails', async () => {
    const findFirst = vi.fn().mockRejectedValue(new Error('search index unavailable'));
    const service = new AIConversationSearchService({
      query: {
        aiConversations: {
          findFirst,
        },
      },
    } as never);

    expect(() => service.rebuildConversationIndexBestEffort('user-1', 'conversation-1')).not.toThrow();

    await vi.waitFor(() => {
      expect(findFirst).toHaveBeenCalled();
    });
  });
});
