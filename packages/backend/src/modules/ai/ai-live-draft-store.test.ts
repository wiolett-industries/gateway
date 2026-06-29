import { describe, expect, it } from 'vitest';
import { AssistantLiveDraftStore } from './ai-live-draft-store.js';

describe('AssistantLiveDraftStore', () => {
  it('keeps draft versions monotonic across boundary content clears', () => {
    const store = new AssistantLiveDraftStore();

    expect(store.append('run-1', 'conversation-1', 'Hel')).toMatchObject({
      content: 'Hel',
      version: 1,
    });
    expect(store.append('run-1', 'conversation-1', 'lo')).toMatchObject({
      content: 'Hello',
      version: 2,
    });

    store.clearContent('run-1');
    expect(store.get('run-1')).toBeNull();

    expect(store.append('run-1', 'conversation-1', 'After approval')).toMatchObject({
      content: 'After approval',
      version: 3,
    });
  });

  it('can forget a completed run completely', () => {
    const store = new AssistantLiveDraftStore();
    store.append('run-1', 'conversation-1', 'Hello');
    store.clearContent('run-1');
    store.append('run-1', 'conversation-1', 'Again');

    store.forget('run-1');

    expect(store.get('run-1')).toBeNull();
    expect(store.append('run-1', 'conversation-1', 'Fresh run')).toMatchObject({
      content: 'Fresh run',
      version: 1,
    });
  });
});
