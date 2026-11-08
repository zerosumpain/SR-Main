import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Usage ingest — the row an application's call becomes must be the row
 * usage-log writes for a call made in Main, keyed by the event id so a retried
 * batch cannot double-count.
 */

const h = vi.hoisted(() => {
  const stored = new Map<string, Record<string, unknown>>();
  const inserts: Record<string, unknown>[][] = [];
  return { stored, inserts };
});

vi.mock('$lib/db', () => ({
  db: {
    insert: () => ({
      values: (rows: Record<string, unknown>[]) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            h.inserts.push(rows);
            const fresh = rows.filter((r) => !h.stored.has(r.id as string));
            for (const r of fresh) h.stored.set(r.id as string, r);
            return fresh.map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
  },
}));
vi.mock('$lib/llm/model-source', () => ({ writeUsage: vi.fn(), loadCatalogue: vi.fn() }));

const { ingestUsageEvents } = await import('./usage-ingest.server');
const { llmCallRow } = await import('$lib/llm/usage-log');

const NOW = Date.parse('2026-10-02T12:00:00Z');
const event = {
  id: '3f2a9c1e-8b4d-4e2f-9a1b-0c1d2e3f4a5b',
  occurredAt: '2026-10-02T11:58:00Z',
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  tokensInput: 120,
  tokensOutput: 40,
  cacheReadTokens: 100,
  reasoningTokens: null,
  costUsd: 0.0000196,
  source: 'gateway',
  activity: 'project-chat',
  origin: null,
  sessionId: 'job-1',
  durationMs: 900,
  ttftMs: 120,
  conversationId: null,
};

beforeEach(() => {
  h.stored.clear();
  h.inserts.length = 0;
});

describe('ingestUsageEvents', () => {
  it('writes the same row usage-log builds, plus id, time and app', async () => {
    const result = await ingestUsageEvents('policy-engine', [event], NOW);
    expect(result).toEqual({ accepted: 1, duplicates: 0, rejected: [] });
    const row = h.stored.get(event.id)!;
    const { id: _id, occurredAt: _at, ...call } = event;
    const expected = llmCallRow(call);
    expect(row).toEqual({
      ...expected,
      id: event.id,
      createdAt: new Date('2026-10-02T11:58:00Z'),
      input: { ...expected.input, app: 'policy-engine' },
    });
    expect(row.actionType).toBe('llm_call');
    expect(row.input).toEqual({ source: 'gateway', activity: 'project-chat', ttftMs: 120, app: 'policy-engine' });
  });

  it('is idempotent by event id, across calls and within a batch', async () => {
    await ingestUsageEvents('drive', [event], NOW);
    const again = await ingestUsageEvents('drive', [event, event], NOW);
    expect(again).toEqual({ accepted: 0, duplicates: 2, rejected: [] });
    expect(h.stored.size).toBe(1);
  });

  it('keeps a null cost null', async () => {
    await ingestUsageEvents('health', [{ ...event, provider: 'codex', model: 'gpt-5.6-terra', costUsd: null }], NOW);
    expect(h.stored.get(event.id)!.costUsd).toBeNull();
  });

  it('reports malformed events and still lands the rest', async () => {
    const good = { ...event, id: '9e8d7c6b-5a49-4382-a716-151413121110' };
    const result = await ingestUsageEvents('drive', [{ ...event, costUsd: 'free' }, good, 'nope'], NOW);
    expect(result.accepted).toBe(1);
    expect(result.rejected.map((r) => [r.index, r.id])).toEqual([[0, event.id], [2, null]]);
    expect(h.stored.has(good.id)).toBe(true);
    expect(h.stored.has(event.id)).toBe(false);
  });

  it('touches the database not at all for an all-invalid batch', async () => {
    await ingestUsageEvents('drive', [{}], NOW);
    expect(h.inserts).toHaveLength(0);
  });
});
