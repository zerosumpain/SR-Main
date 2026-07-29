import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ records: [] as Array<{ key: string; data: unknown }> }));

vi.mock('$lib/datastore', () => ({
  getCollectionBySlug: vi.fn().mockResolvedValue({ id: 'c1' }),
  queryRecords: vi.fn(async () => ({ records: h.records })),
  upsertRecord: vi.fn(async (_slug: string, rec: { key: string; data: unknown }) => {
    const i = h.records.findIndex((r) => r.key === rec.key);
    if (i >= 0) h.records[i] = rec;
    else h.records.push(rec);
    return { id: rec.key };
  }),
}));

import { addIdeas, listBacklog, markAttempt, pickWork } from './backlog';
import type { BacklogItemData } from './types';

function item(over: Partial<BacklogItemData>): BacklogItemData {
  return {
    slug: 'x',
    title: 'X',
    detail: '',
    kind: 'tool',
    status: 'open',
    priority: 3,
    attempts: 0,
    createdAt: 'now',
    updatedAt: 'now',
    ...over,
  };
}

beforeEach(() => {
  h.records = [];
  vi.clearAllMocks();
});

describe('addIdeas — dedupe is what stops nightly re-invention', () => {
  it('adds new ideas and slugifies the title into the key', async () => {
    const added = await addIdeas([{ title: 'News digest tool', detail: 'd', kind: 'tool' }]);
    expect(added).toEqual(['news-digest-tool']);
    expect(h.records[0].key).toBe('news-digest-tool');
  });

  it('does not re-add an idea that already exists', async () => {
    await addIdeas([{ title: 'News digest tool', detail: 'd', kind: 'tool' }]);
    const again = await addIdeas([{ title: 'News digest tool', detail: 'different wording', kind: 'tool' }]);
    expect(again).toEqual([]);
    expect(h.records).toHaveLength(1);
  });

  it('preserves attempt history when the same idea is proposed again', async () => {
    await addIdeas([{ title: 'Current time', detail: 'd', kind: 'tool' }]);
    const existing = h.records[0].data as BacklogItemData;
    await markAttempt(existing, { status: 'open', error: 'HTTP 405' });
    await addIdeas([{ title: 'Current time', detail: 'd', kind: 'tool' }]);
    const after = h.records[0].data as BacklogItemData;
    expect(after.attempts).toBe(1);
    expect(after.lastError).toBe('HTTP 405');
  });

  it('ignores blank titles', async () => {
    expect(await addIdeas([{ title: '   ', detail: 'd', kind: 'tool' }])).toEqual([]);
  });
});

describe('pickWork', () => {
  it('prefers never-attempted items, then priority', () => {
    const items = [
      item({ slug: 'a', attempts: 2, priority: 1 }),
      item({ slug: 'b', attempts: 0, priority: 4 }),
      item({ slug: 'c', attempts: 0, priority: 2 }),
    ];
    expect(pickWork(items, 'tool', 3).map((i) => i.slug)).toEqual(['c', 'b', 'a']);
  });

  it('skips items that have failed four times', () => {
    const items = [item({ slug: 'dead', attempts: 4 }), item({ slug: 'live', attempts: 1 })];
    expect(pickWork(items, 'tool', 5).map((i) => i.slug)).toEqual(['live']);
  });

  it('filters by kind and excludes shipped work', () => {
    const items = [
      item({ slug: 'feat', kind: 'feature' }),
      item({ slug: 'done', kind: 'tool', status: 'shipped' }),
      item({ slug: 'todo', kind: 'tool' }),
    ];
    expect(pickWork(items, 'tool', 5).map((i) => i.slug)).toEqual(['todo']);
    expect(pickWork(items, 'feature', 5).map((i) => i.slug)).toEqual(['feat']);
  });
});

describe('markAttempt', () => {
  it('increments attempts and records the failure for the next author call', async () => {
    await markAttempt(item({ slug: 'a', attempts: 1 }), { status: 'open', error: 'HTTP 405', runId: 'r1' });
    const saved = h.records[0].data as BacklogItemData;
    expect(saved.attempts).toBe(2);
    expect(saved.lastError).toBe('HTTP 405');
    expect(saved.lastAttemptRunId).toBe('r1');
    expect(saved.status).toBe('open');
  });

  it('marks shipped items so they stop being picked', async () => {
    await markAttempt(item({ slug: 'a' }), { status: 'shipped', runId: 'r1' });
    const saved = h.records[0].data as BacklogItemData;
    expect(saved.status).toBe('shipped');
    expect(pickWork([saved], 'tool', 5)).toEqual([]);
  });

  it('stores a PR url when one was opened', async () => {
    await markAttempt(item({ slug: 'a', kind: 'feature' }), {
      status: 'shipped',
      prUrl: 'https://github.com/x/y/pull/1',
    });
    expect((h.records[0].data as BacklogItemData).prUrl).toBe('https://github.com/x/y/pull/1');
  });
});

describe('listBacklog', () => {
  it('filters by status when asked', async () => {
    h.records = [
      { key: 'a', data: item({ slug: 'a', status: 'open' }) },
      { key: 'b', data: item({ slug: 'b', status: 'shipped' }) },
    ];
    expect((await listBacklog('open')).map((i) => i.slug)).toEqual(['a']);
    expect(await listBacklog()).toHaveLength(2);
  });
});
