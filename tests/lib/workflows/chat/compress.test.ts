import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getRecordByKey, upsertRecord, ensureCollection, create } = vi.hoisted(() => ({
  getRecordByKey: vi.fn(),
  upsertRecord: vi.fn(),
  ensureCollection: vi.fn(),
  create: vi.fn(),
}));

vi.mock('$lib/datastore', () => ({
  ensureCollection: (...a: unknown[]) => ensureCollection(...a),
  upsertRecord: (...a: unknown[]) => upsertRecord(...a),
  getRecordByKey: (...a: unknown[]) => getRecordByKey(...a),
}));
vi.mock('$lib/server/models/workload-settings', () => ({
  resolveChatMaintenanceModel: async () => ({ provider: 'openrouter', modelId: 'm' }),
}));
vi.mock('$lib/llm/client', () => ({
  getLLMClient: async () => ({ client: { chat: { completions: { create: (...a: unknown[]) => create(...a) } } }, model: 'm' }),
}));

import {
  compressHistory,
  refreshCompression,
  renderCompressionSection,
  KEEP_RECENT,
} from '$lib/workflows/chat/compress';

function hist(n: number, startMs = 1_000_000): Array<{ role: string; content: string; attachments: never[]; createdAt: Date }> {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `message ${i}`,
    attachments: [] as never[],
    createdAt: new Date(startMs + i * 1000),
  }));
}
const summaryOf = (text: string) => ({ choices: [{ message: { content: text } }] });

beforeEach(() => {
  vi.clearAllMocks();
  getRecordByKey.mockResolvedValue(undefined);
  create.mockResolvedValue(summaryOf('They agreed the deploy would wait until Tuesday, and that the VPS key rotates monthly.'));
});

/**
 * The split matters: `compressHistory` is awaited BEFORE the system prompt is
 * assembled, so anything it does lands in front of the reader's first token.
 * Summarising is an LLM call, so it moved to `refreshCompression`, which runs
 * after the reply has gone out.
 */
describe('compressHistory — reads the cache, never writes it', () => {
  it('does nothing to a short thread — no summary, no LLM call', async () => {
    const h = hist(10);
    const r = await compressHistory(h, 'c1', KEEP_RECENT);
    expect(r).toMatchObject({ summary: null, compressedCount: 0, degraded: false, needsRefresh: false });
    expect(r.messages).toHaveLength(10);
    expect(create).not.toHaveBeenCalled();
  });

  it('never calls the model, however long the thread', async () => {
    // The whole point. This runs before the first token.
    await compressHistory(hist(200), 'c1', 30);
    expect(create).not.toHaveBeenCalled();
    expect(upsertRecord).not.toHaveBeenCalled();
  });

  it('serves a cached summary and keeps the recent tail verbatim', async () => {
    getRecordByKey.mockResolvedValue({
      data: {
        conversationId: 'c1',
        summary: 'Agreed the deploy waits until Tuesday.',
        coversUpTo: new Date(1_000_000 + 19 * 1000).toISOString(),
        messageCount: 20,
        updatedAt: new Date().toISOString(),
      },
    });
    const r = await compressHistory(hist(50), 'c1', 30);
    expect(r.messages).toHaveLength(30);
    expect(r.messages[0].content).toBe('message 20'); // the tail, not the head
    expect(r.summary).toContain('Tuesday');
    expect(r.compressedCount).toBe(20);
    expect(r.degraded).toBe(false);
    expect(r.needsRefresh).toBe(false);
  });

  it('flags a stale summary rather than implying it covers what it has not seen', async () => {
    getRecordByKey.mockResolvedValue({
      data: {
        conversationId: 'c1',
        summary: 'Only the first few turns.',
        coversUpTo: new Date(1_000_000).toISOString(), // covers message 0 only
        messageCount: 1,
        updatedAt: new Date().toISOString(),
      },
    });
    const r = await compressHistory(hist(50), 'c1', 30);
    expect(r.summary).toContain('first few turns');
    expect(r.degraded).toBe(true);
    expect(r.needsRefresh).toBe(true);
    // Counts what it covers PLUS what it does not yet.
    expect(r.compressedCount).toBeGreaterThan(1);
  });

  describe('honest degradation', () => {
    it('keeps MORE raw messages, not fewer, when there is no summary yet', async () => {
      getRecordByKey.mockResolvedValue(undefined);
      const r = await compressHistory(hist(200), 'c1', 30);
      expect(r.messages.length).toBe(60);
      expect(r.degraded).toBe(true);
      expect(r.needsRefresh).toBe(true);
    });

    it('says earlier context is missing rather than pretending it never existed', async () => {
      getRecordByKey.mockResolvedValue(undefined);
      const r = await compressHistory(hist(50), 'c1', 30);
      expect(renderCompressionSection(r)).toContain('not available in this turn');
    });

    it('falls back to truncation without a conversation id, and flags it', async () => {
      const r = await compressHistory(hist(50), null, 30);
      expect(r.messages).toHaveLength(30);
      expect(r.degraded).toBe(true);
      // Nothing to refresh: no key to store it under.
      expect(r.needsRefresh).toBe(false);
    });

    it('a datastore read failure costs the turn nothing', async () => {
      getRecordByKey.mockRejectedValue(new Error('datastore down'));
      await expect(compressHistory(hist(50), 'c1', 30)).resolves.toBeDefined();
    });
  });
});

describe('refreshCompression — the LLM half, after the reply', () => {
  it('summarises the overflow and stores how far it covers', async () => {
    const r = await refreshCompression(hist(50), 'c1', 30);
    expect(r.refreshed).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    const rec = upsertRecord.mock.calls[0][1] as { key: string; data: Record<string, unknown> };
    expect(rec.key).toBe('c1');
    expect(rec.data.coversUpTo).toBe(new Date(1_000_000 + 19 * 1000).toISOString());
    expect(rec.data.messageCount).toBe(20);
  });

  it('does nothing when the cached summary already covers the overflow', async () => {
    getRecordByKey.mockResolvedValue({
      data: {
        conversationId: 'c1',
        summary: 'digest',
        coversUpTo: new Date(1_000_000 + 19 * 1000).toISOString(),
        messageCount: 20,
        updatedAt: new Date().toISOString(),
      },
    });
    const r = await refreshCompression(hist(50), 'c1', 30);
    expect(r.refreshed).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('FOLDS new overflow into the existing digest rather than re-summarising everything', async () => {
    getRecordByKey.mockResolvedValue({
      data: {
        conversationId: 'c1',
        summary: 'earlier digest',
        coversUpTo: new Date(1_000_000).toISOString(),
        messageCount: 1,
        updatedAt: new Date().toISOString(),
      },
    });
    await refreshCompression(hist(50), 'c1', 30);
    const sent = JSON.stringify(create.mock.calls[0][0]);
    expect(sent).toContain('earlier digest');
    // Only what the digest has not seen is re-read.
    expect(sent).not.toContain('message 0"');
  });

  it('summarises everything older on a FIRST run, not just the tail', async () => {
    getRecordByKey.mockResolvedValue(undefined);
    await refreshCompression(hist(50), 'c1', 30);
    const rec = upsertRecord.mock.calls[0][1] as { data: Record<string, unknown> };
    expect(rec.data.messageCount).toBe(20);
  });

  it('does nothing on a thread shorter than the window', async () => {
    const r = await refreshCompression(hist(10), 'c1', 30);
    expect(r.refreshed).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a uselessly short summary rather than storing it', async () => {
    create.mockResolvedValue(summaryOf('ok'));
    const r = await refreshCompression(hist(50), 'c1', 30);
    expect(r.refreshed).toBe(false);
    expect(upsertRecord).not.toHaveBeenCalled();
  });

  it('never throws into the turn — it runs unawaited', async () => {
    create.mockRejectedValue(new Error('model down'));
    await expect(refreshCompression(hist(50), 'c1', 30)).resolves.toMatchObject({ refreshed: false });
  });
});

describe('renderCompressionSection', () => {
  it('says how many messages the summary stands in for', () => {
    const s = renderCompressionSection({ messages: [], summary: 'digest', compressedCount: 42, degraded: false, needsRefresh: false });
    expect(s).toContain('42 messages');
    expect(s).toContain('digest');
  });

  it('is empty when nothing was dropped', () => {
    expect(renderCompressionSection({ messages: [], summary: null, compressedCount: 0, degraded: false, needsRefresh: false })).toBe('');
  });
});

it.each([1, 2, 3, 4, 5, 6, 7, 8])('retains all %i messages not yet covered by the summary', async gap => {
  getRecordByKey.mockResolvedValue({ data: { conversationId: 'gap', summary: 'earlier decisions', coversUpTo: new Date(1_000_000 + 19 * 1000).toISOString(), messageCount: 20 } });
  const result = await compressHistory(hist(50 + gap), 'gap', 30);
  expect(result.messages).toHaveLength(30 + gap);
  expect(result.messages[0].content).toBe('message 20');
  expect(result.degraded).toBe(false);
});
