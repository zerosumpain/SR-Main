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
vi.mock('$lib/server/models/settings', () => ({ resolveDefaultModel: async () => ({ provider: 'openrouter', modelId: 'm' }) }));
vi.mock('$lib/jkai/llm-client', () => ({
  getLLMClient: async () => ({ client: { chat: { completions: { create: (...a: unknown[]) => create(...a) } } }, model: 'm' }),
}));

import { compressHistory, renderCompressionSection, KEEP_RECENT } from '$lib/workflows/chat/compress';

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

describe('compressHistory', () => {
  it('does nothing to a short thread — no summary, no LLM call', async () => {
    const h = hist(10);
    const r = await compressHistory(h, 'c1', KEEP_RECENT);
    expect(r).toMatchObject({ summary: null, compressedCount: 0, degraded: false });
    expect(r.messages).toHaveLength(10);
    expect(create).not.toHaveBeenCalled();
  });

  it('summarises the overflow and keeps the recent tail verbatim', async () => {
    const h = hist(50);
    const r = await compressHistory(h, 'c1', 30);
    expect(r.messages).toHaveLength(30);
    expect(r.messages[0].content).toBe('message 20'); // the tail, not the head
    expect(r.summary).toContain('Tuesday');
    expect(r.compressedCount).toBe(20);
    expect(create).toHaveBeenCalledOnce();
  });

  it('persists the summary with how far it covers', async () => {
    await compressHistory(hist(50), 'c1', 30);
    const rec = upsertRecord.mock.calls[0][1] as { key: string; data: Record<string, unknown> };
    expect(rec.key).toBe('c1');
    expect(rec.data.messageCount).toBe(20);
    // covers up to the last message that fell OUT of the window, not the newest
    expect(rec.data.coversUpTo).toBe(hist(50)[19].createdAt.toISOString());
  });

  it('reuses a cached summary without calling the model again', async () => {
    const h = hist(50);
    getRecordByKey.mockResolvedValue({
      data: { conversationId: 'c1', summary: 'cached digest', coversUpTo: h[19].createdAt.toISOString(), messageCount: 20 },
    });
    const r = await compressHistory(h, 'c1', 30);
    expect(r.summary).toBe('cached digest');
    expect(create).not.toHaveBeenCalled();
  });

  it('FOLDS new overflow into the existing digest rather than re-summarising everything', async () => {
    // This is what stops a long thread costing an LLM call per turn for ever.
    const h = hist(70);
    getRecordByKey.mockResolvedValue({
      data: { conversationId: 'c1', summary: 'earlier digest', coversUpTo: h[19].createdAt.toISOString(), messageCount: 20 },
    });
    await compressHistory(h, 'c1', 30);
    expect(create).toHaveBeenCalledOnce();
    const body = create.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const user = body.messages[1].content;
    expect(user).toContain('earlier digest');       // the previous digest is carried in
    expect(user).toContain('message 39');            // only the NEW overflow
    expect(user).not.toContain('message 5');         // already covered — not resent
  });

  describe('honest degradation', () => {
    it('keeps MORE raw messages, not fewer, when summarising fails', async () => {
      create.mockRejectedValue(new Error('provider down'));
      const r = await compressHistory(hist(100), 'c1', 30);
      // Never worse than the old truncation: that kept 30.
      expect(r.messages.length).toBeGreaterThan(30);
      expect(r.degraded).toBe(true);
    });

    it('says earlier context is missing rather than pretending it never existed', async () => {
      create.mockRejectedValue(new Error('provider down'));
      const r = await compressHistory(hist(100), 'c1', 30);
      const section = renderCompressionSection(r);
      expect(section).toMatch(/not available/i);
      expect(section).toMatch(/say so rather than guessing/i);
    });

    it('falls back to truncation without a conversation id, and flags it', async () => {
      // A canvas chat has no id to cache against; paying an LLM call per turn
      // for a summary that is immediately discarded would be worse.
      const r = await compressHistory(hist(50), null, 30);
      expect(create).not.toHaveBeenCalled();
      expect(r.degraded).toBe(true);
      expect(r.messages).toHaveLength(30);
    });

    it('a datastore read failure costs the turn nothing', async () => {
      getRecordByKey.mockRejectedValue(new Error('db down'));
      const r = await compressHistory(hist(50), 'c1', 30);
      expect(r.summary).toBeTruthy();
    });

    it('rejects a uselessly short summary rather than storing it', async () => {
      create.mockResolvedValue(summaryOf('ok'));
      const r = await compressHistory(hist(50), 'c1', 30);
      expect(r.summary).toBeNull();
      expect(upsertRecord).not.toHaveBeenCalled();
    });
  });
});

describe('renderCompressionSection', () => {
  it('says how many messages the summary stands in for', () => {
    const s = renderCompressionSection({ messages: [], summary: 'digest', compressedCount: 42, degraded: false });
    expect(s).toContain('42 messages');
    expect(s).toContain('digest');
  });

  it('is empty when nothing was dropped', () => {
    expect(renderCompressionSection({ messages: [], summary: null, compressedCount: 0, degraded: false })).toBe('');
  });
});
