import { describe, it, expect, vi, beforeEach } from 'vitest';

// The per-thread opt-out is a guard on a hot path, and a guard nothing checks is
// the failure this codebase has already had once: a shape change made a gate
// pass everything and nobody noticed until the thing it protected went wrong.
// So this asserts the only claim that matters — the toggle being off means the
// extractor is never called, including on a forced backfill pass.

const selectResult = { rows: [] as unknown[] };

vi.mock('$lib/db', () => {
  // Two selects run in order: the conversation's flag, then the transcript.
  // A tiny chainable stub is enough — nothing here tests drizzle.
  const chain = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'from', 'where', 'orderBy', 'limit', 'groupBy']) {
      q[m] = () => q;
    }
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(selectResult.rows.shift() ?? []).then(resolve);
    return q;
  };
  return { db: chain() };
});

vi.mock('$lib/db/schema', () => ({
  conversations: { id: 'id', intelEnabled: 'intel_enabled' },
  orchestratorChats: { conversationId: 'conversation_id', role: 'role', content: 'content', metadata: 'metadata', createdAt: 'created_at' },
}));

const extractIntoIntel = vi.fn(async () => ({ status: 'extracted' as const, entityCount: 3 }));
vi.mock('./auto-extract', () => ({ extractIntoIntel: (...a: unknown[]) => extractIntoIntel(...(a as [])) }));

const publishConversationSignal = vi.fn();
vi.mock('$lib/workflows/chat/followup-queue', () => ({
  publishConversationSignal: (...a: unknown[]) => publishConversationSignal(...(a as [])),
}));

const { maybeExtractThreadConcepts } = await import('./chat-extract');

const TRANSCRIPT = [
  { role: 'user', content: 'what is the data spine', metadata: null },
  { role: 'assistant', content: 'A shared identifier layer.', metadata: null },
];

beforeEach(() => {
  extractIntoIntel.mockClear();
  publishConversationSignal.mockClear();
  selectResult.rows = [];
});

describe('maybeExtractThreadConcepts — the per-thread opt-out', () => {
  it('extracts when the thread is feeding intel', async () => {
    selectResult.rows = [[{ intelEnabled: true }], TRANSCRIPT];
    await maybeExtractThreadConcepts('c1', 'a thread');
    expect(extractIntoIntel).toHaveBeenCalledTimes(1);
  });

  it('does not call the extractor when the thread has opted out', async () => {
    selectResult.rows = [[{ intelEnabled: false }], TRANSCRIPT];
    await maybeExtractThreadConcepts('c1', 'a thread');
    expect(extractIntoIntel).not.toHaveBeenCalled();
    // And no "linking…" indicator, which would sit there forever.
    expect(publishConversationSignal).not.toHaveBeenCalled();
  });

  it('still refuses on a forced backfill — a sweep must not undo the choice', async () => {
    selectResult.rows = [[{ intelEnabled: false }], TRANSCRIPT];
    await maybeExtractThreadConcepts('c1', 'a thread', { force: true });
    expect(extractIntoIntel).not.toHaveBeenCalled();
  });

  it('extracts when the conversation row is missing rather than failing closed', async () => {
    // Deleted mid-flight. Silently dropping the extraction would be a data loss
    // dressed up as a preference.
    selectResult.rows = [[], TRANSCRIPT];
    await maybeExtractThreadConcepts('c1', 'a thread');
    expect(extractIntoIntel).toHaveBeenCalledTimes(1);
  });
});
