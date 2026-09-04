import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  records: [] as Array<{ key: string; data: unknown }>,
  /** Set to make getRecordByKey blow up, for the fail-closed test. */
  keyReadFails: false,
}));

// The real datastore pages (LIMIT/OFFSET, clamped at 500) and throws a
// `not_found` DatastoreError from getRecordByKey. The old mock did neither: it
// returned every record for any query, which is exactly why a `limit: 200`
// that truncated 210 of production's 410 rows looked fine here.
vi.mock('$lib/datastore', () => {
  class DatastoreError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = 'DatastoreError';
    }
  }
  return {
    DatastoreError,
    getCollectionBySlug: vi.fn().mockResolvedValue({ id: 'c1' }),
    queryRecords: vi.fn(async (_slug: string, opts: { limit?: number; offset?: number }) => {
      const limit = Math.min(opts?.limit ?? 100, 500);
      const offset = opts?.offset ?? 0;
      return { records: h.records.slice(offset, offset + limit) };
    }),
    getRecordByKey: vi.fn(async (_slug: string, key: string) => {
      if (h.keyReadFails) throw new Error('datastore unavailable');
      const found = h.records.find((r) => r.key === key);
      if (!found) throw new DatastoreError('not_found', 'absent');
      return found;
    }),
    upsertRecord: vi.fn(async (_slug: string, rec: { key: string; data: unknown }) => {
      const i = h.records.findIndex((r) => r.key === rec.key);
      if (i >= 0) h.records[i] = rec;
      else h.records.push(rec);
      return { id: rec.key };
    }),
  };
});

import {
  addIdeas,
  hasOpenNewDataWork,
  listBacklog,
  markAttempt,
  pickToolWork,
  pickWork,
  MAX_NEW_IDEAS_PER_NIGHT,
} from './backlog';
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

beforeEach(() => {
  h.records = [];
  h.keyReadFails = false;
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
  it('leads with never-attempted items, by priority', () => {
    const items = [
      item({ slug: 'a', attempts: 2, priority: 1 }),
      item({ slug: 'b', attempts: 0, priority: 4 }),
      item({ slug: 'c', attempts: 0, priority: 2 }),
    ];
    expect(pickWork(items, 'tool', 3).map((i) => i.slug)).toEqual(['c', 'b', 'a']);
  });

  it('still reaches a retry when untried work could fill every slot', () => {
    // The bug this replaces. `attempts ASC` ranked the whole untried pile above
    // the whole retry pile, and twelve to seventeen fresh items arrived every
    // night — so anything that failed once fell permanently behind and the
    // `attempts < 4` budget plus the `lastError` feedback never ran at all.
    const items = [
      ...Array.from({ length: 8 }, (_, n) =>
        item({ slug: `fresh${n}`, attempts: 0, priority: 3 }),
      ),
      item({ slug: 'retry', attempts: 1, priority: 3 }),
    ];
    const picked = pickWork(items, 'tool', 3).map((i) => i.slug);
    expect(picked).toContain('retry');
    expect(picked).toHaveLength(3);
  });

  it('reserves a retry slot even at the propose phase limit of 2', () => {
    // `Math.floor(2 * 1/3)` is 0. A bare proportion would have left features —
    // which run at maxPullRequests: 2 — never retried at all.
    const items = [
      item({ slug: 'fresh', kind: 'feature', attempts: 0 }),
      item({ slug: 'other', kind: 'feature', attempts: 0 }),
      item({ slug: 'retry', kind: 'feature', attempts: 2 }),
    ];
    expect(pickWork(items, 'feature', 2).map((i) => i.slug)).toContain('retry');
  });

  it('gives a single slot to whichever item priority actually favours', () => {
    // Reserving the only slot for a retry would be the same bug with the
    // classes swapped, so at limit 1 priority decides outright.
    const urgentFresh = [
      item({ slug: 'fresh', attempts: 0, priority: 1 }),
      item({ slug: 'retry', attempts: 1, priority: 4 }),
    ];
    expect(pickWork(urgentFresh, 'tool', 1).map((i) => i.slug)).toEqual(['fresh']);

    const urgentRetry = [
      item({ slug: 'fresh', attempts: 0, priority: 4 }),
      item({ slug: 'retry', attempts: 1, priority: 1 }),
    ];
    expect(pickWork(urgentRetry, 'tool', 1).map((i) => i.slug)).toEqual(['retry']);
  });

  it('backfills from the other class rather than under-filling the run', () => {
    const items = [
      item({ slug: 'r1', attempts: 1 }),
      item({ slug: 'r2', attempts: 2 }),
      item({ slug: 'r3', attempts: 3 }),
    ];
    // No untried work at all — the retries take every slot.
    expect(pickWork(items, 'tool', 3)).toHaveLength(3);
  });

  it('never returns a duplicate', () => {
    const items = [
      item({ slug: 'a', attempts: 0 }),
      item({ slug: 'b', attempts: 1 }),
    ];
    const picked = pickWork(items, 'tool', 5).map((i) => i.slug);
    expect(new Set(picked).size).toBe(picked.length);
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

describe('the 200-row window that hid half the backlog', () => {
  it('reads past one page — 410 rows, not the newest 200', async () => {
    // Production held 410 items on 2026-08-30 with a `limit: 200` query, so
    // 210 were invisible: pickWork could not reach them, and an idea not
    // picked in its first fortnight could never be picked again.
    h.records = Array.from({ length: 410 }, (_, n) => ({
      key: `i${n}`,
      data: item({ slug: `i${n}` }),
    }));
    expect(await listBacklog()).toHaveLength(410);
  });

  it('does not resurrect an item that fell outside the first page', async () => {
    // The latent half: a slug the truncated list could not see read as absent,
    // so addIdeas wrote it fresh — attempts 0, status open — erasing the
    // history of work already shipped.
    h.records = Array.from({ length: 600 }, (_, n) => ({
      key: `i${n}`,
      data: item({ slug: `i${n}` }),
    }));
    h.records.push({
      key: 'buried-idea',
      data: item({ slug: 'buried-idea', status: 'shipped', attempts: 3 }),
    });
    await addIdeas([{ title: 'Buried idea', detail: 'd', kind: 'tool' }]);
    const after = h.records.find((r) => r.key === 'buried-idea')!.data as BacklogItemData;
    expect(after.status).toBe('shipped');
    expect(after.attempts).toBe(3);
  });

  it('fails closed when the existence check cannot be answered', async () => {
    // Losing one night's idea is recoverable; erasing attempt history is not.
    h.keyReadFails = true;
    expect(await addIdeas([{ title: 'Anything', detail: 'd', kind: 'tool' }])).toEqual([]);
  });
});

describe('intake cap', () => {
  it('stops one call adding more than a night allows', async () => {
    const ideas = Array.from({ length: 40 }, (_, n) => ({
      title: `Idea number ${n}`,
      detail: 'd',
      kind: 'tool' as const,
    }));
    expect(await addIdeas(ideas)).toHaveLength(MAX_NEW_IDEAS_PER_NIGHT);
  });

  it('counts what the other call sites already added', async () => {
    // There are four callers — analyze, toolsmith twice, and the trace-analyse
    // route — so a per-CALL cap would be four times the number it claims.
    await addIdeas(
      Array.from({ length: MAX_NEW_IDEAS_PER_NIGHT }, (_, n) => ({
        title: `First batch ${n}`,
        detail: 'd',
        kind: 'tool' as const,
      })),
    );
    const second = await addIdeas([{ title: 'A later idea', detail: 'd', kind: 'tool' }]);
    expect(second).toEqual([]);
  });

  it('lets the budget recover once the previous night ages out', async () => {
    const old = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    h.records = Array.from({ length: 30 }, (_, n) => ({
      key: `old${n}`,
      data: item({ slug: `old${n}`, createdAt: old }),
    }));
    expect(await addIdeas([{ title: 'Fresh idea today', detail: 'd', kind: 'tool' }])).toEqual([
      'fresh-idea-today',
    ]);
  });
});

// The lanes that arrived with the appetite ledger, 2026-09-04. The bias toward
// new data is half an ordering and half arithmetic; this is the arithmetic.
describe('the new-data lanes', () => {
  const src = (slug: string, over: Partial<BacklogItemData> = {}) =>
    item({ slug, kind: 'source', priority: 1, ...over });
  const tool = (slug: string, over: Partial<BacklogItemData> = {}) =>
    item({ slug, kind: 'tool', priority: 2, ...over });

  it('holds half the toolsmith’s slots for sources when any is open', () => {
    const picked = pickToolWork(
      [src('s1'), src('s2'), src('s3'), tool('t1'), tool('t2'), tool('t3')],
      4,
    );
    expect(picked.filter((i) => i.kind === 'source')).toHaveLength(2);
    expect(picked.filter((i) => i.kind === 'tool')).toHaveLength(2);
  });

  it('reserves at least one slot even when the share rounds to zero', () => {
    const picked = pickToolWork([src('s1'), tool('t1')], 1);
    expect(picked.map((i) => i.slug)).toEqual(['s1']);
  });

  it('gives the whole night to tools when no source is waiting', () => {
    const picked = pickToolWork([tool('t1'), tool('t2')], 4);
    expect(picked.map((i) => i.slug)).toEqual(['t1', 't2']);
  });

  it('backfills rather than doing less work than the cap allows', () => {
    const picked = pickToolWork([src('s1'), tool('t1'), tool('t2'), tool('t3')], 4);
    expect(picked).toHaveLength(4);
  });

  it('never hands the toolsmith a watch — a monitor is not a runtime tool', () => {
    const picked = pickToolWork([item({ slug: 'w1', kind: 'watch' }), tool('t1')], 4);
    expect(picked.map((i) => i.slug)).toEqual(['t1']);
  });

  it('reports open new-data work, which is what demotes call efficiency', () => {
    expect(hasOpenNewDataWork([tool('t1')])).toBe(false);
    expect(hasOpenNewDataWork([src('s1')])).toBe(true);
    expect(hasOpenNewDataWork([item({ slug: 'w1', kind: 'watch' })])).toBe(true);
    // Shipped, and exhausted, are not open.
    expect(hasOpenNewDataWork([src('s1', { status: 'shipped' })])).toBe(false);
    expect(hasOpenNewDataWork([src('s1', { attempts: 9 })])).toBe(false);
  });

  it('keeps the new kinds through a write, and coerces an unknown one to tool', async () => {
    await addIdeas([
      { title: 'A rail feed', detail: 'd', kind: 'source', capabilitySlug: 'data_source:rail' },
      { title: 'A watch on something', detail: 'd', kind: 'watch' },
      { title: 'Something odd', detail: 'd', kind: 'dashboard' as unknown as BacklogItemData['kind'] },
    ]);
    const back = await listBacklog();
    expect(back.find((i) => i.slug === 'a-rail-feed')?.kind).toBe('source');
    expect(back.find((i) => i.slug === 'a-rail-feed')?.capabilitySlug).toBe('data_source:rail');
    expect(back.find((i) => i.slug === 'a-watch-on-something')?.kind).toBe('watch');
    expect(back.find((i) => i.slug === 'something-odd')?.kind).toBe('tool');
  });
});
