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

  it('excludes the current conversation from chat search', async () => {
    const service = new AIConversationSearchService({} as never);
    const internals = service as unknown as {
      queryDocuments: (
        conditions: unknown[],
        matchedBy: string,
        baseScore: number,
        limit: number
      ) => Promise<unknown[]>;
      fuzzyDocuments: (conditions: unknown[], normalizedQuery: string, limit: number) => Promise<unknown[]>;
      groupConversationMatches: (rows: unknown[], limit: number) => Promise<unknown[]>;
      auditRetrieval: (userId: string, input: unknown) => Promise<void>;
      getOwnedConversation: (userId: string, conversationId: string) => Promise<unknown>;
      resolveScope: (userId: string, currentConversationId: string | null, scope: unknown) => Promise<unknown>;
    };
    const queryDocuments = vi.spyOn(internals, 'queryDocuments').mockResolvedValue([]);
    vi.spyOn(internals, 'fuzzyDocuments').mockResolvedValue([]);
    vi.spyOn(internals, 'groupConversationMatches').mockResolvedValue([]);
    vi.spyOn(internals, 'auditRetrieval').mockResolvedValue(undefined);
    vi.spyOn(service, 'backfillMissingIndexes').mockResolvedValue(0);
    vi.spyOn(internals, 'getOwnedConversation').mockResolvedValue({
      id: 'conversation-current',
      folderId: null,
    });
    vi.spyOn(internals, 'resolveScope').mockResolvedValue({ type: 'no_project' });

    await service.searchChats('user-1', {
      query: 'certificate renewal',
      currentConversationId: 'conversation-current',
      scope: { type: 'no_project' },
    });

    expect(queryDocuments).toHaveBeenCalled();
    const firstConditions = queryDocuments.mock.calls[0][0] as unknown[];
    expect(firstConditions).toHaveLength(4);
  });
});
