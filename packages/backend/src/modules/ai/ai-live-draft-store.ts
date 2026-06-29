export interface AssistantLiveDraft {
  conversationId: string;
  runId: string;
  content: string;
  version: number;
}

export class AssistantLiveDraftStore {
  private readonly drafts = new Map<string, Omit<AssistantLiveDraft, 'version'>>();
  private readonly versions = new Map<string, number>();

  append(runId: string, conversationId: string, delta: string): AssistantLiveDraft {
    const previous = this.drafts.get(runId);
    const version = (this.versions.get(runId) ?? 0) + 1;
    this.versions.set(runId, version);

    const draft = {
      conversationId,
      runId,
      content: `${previous?.content ?? ''}${delta}`,
    };
    this.drafts.set(runId, draft);

    return { ...draft, version };
  }

  get(runId: string): AssistantLiveDraft | null {
    const draft = this.drafts.get(runId);
    if (!draft) return null;
    return {
      ...draft,
      version: this.versions.get(runId) ?? 0,
    };
  }

  getContent(runId: string, fallbackContent?: string | null): string {
    return this.drafts.get(runId)?.content ?? fallbackContent ?? '';
  }

  clearContent(runId: string): void {
    this.drafts.delete(runId);
  }

  forget(runId: string): void {
    this.drafts.delete(runId);
    this.versions.delete(runId);
  }
}
