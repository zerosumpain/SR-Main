import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/workflows/backlog-grooming.server', () => ({ groomAfterIntake: vi.fn(async () => {}) }));
import { groomAfterIntake } from '$lib/workflows/backlog-grooming.server';

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
  addBacklogNote,
  addIdeas,
  createBacklogItem,
  foldItems,
  hasOpenNewDataWork,
  listBacklog,
  markAttempt,
  pickFoldSurvivor,
  pickToolWork,
  pickWork,
  removeBacklogItem,
  removeBacklogNote,
  setEpic,
  setParked,
  setParkedMany,
  setPriority,
  setPriorityMany,
  updateBacklogItem,
  MAX_NEW_IDEAS_PER_NIGHT,
} from './backlog';
import { MAX_BACKLOG_NOTES } from './grooming';
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

// ── Owner edits from the queue board ──────────────────────────────────────

describe('owner edits', () => {
  beforeEach(() => {
    h.records = [];
    h.keyReadFails = false;
  });

  function seed(...items: BacklogItemData[]) {
    h.records = items.map((i) => ({ key: i.slug, data: i }));
  }
  const stored = (slug: string) => h.records.find((r) => r.key === slug)?.data as BacklogItemData;

  describe('feature management', () => {
    it('adds owner-authored work without consuming the nightly proposal cap', async () => {
      seed(...Array.from({ length: MAX_NEW_IDEAS_PER_NIGHT }, (_, n) =>
        item({ slug: `night-${n}`, title: `Night ${n}`, createdAt: new Date().toISOString() }),
      ));
      const created = await createBacklogItem({
        title: 'A hand written feature',
        detail: 'Keep the exact outcome the owner asked for.',
        kind: 'feature',
        priority: 1,
      });
      expect(created.slug).toBe('a-hand-written-feature');
      expect(created.source).toBe('owner');
      expect(created.priority).toBe(1);
      expect(stored(created.slug).detail).toContain('exact outcome');
    });

    it('refuses a duplicate instead of erasing its history', async () => {
      seed(item({ slug: 'same-feature', title: 'Same feature', attempts: 3, lastError: 'failed before' }));
      await expect(createBacklogItem({ title: 'Same feature', detail: 'new', kind: 'tool', priority: 3 }))
        .rejects.toThrow(/already exists/);
      expect(stored('same-feature').attempts).toBe(3);
      expect(stored('same-feature').lastError).toBe('failed before');
    });

    it('edits owner-controlled fields and keeps the stable receipt fields', async () => {
      seed(item({
        slug: 'stable-key',
        title: 'Old title',
        detail: 'old brief',
        kind: 'tool',
        priority: 4,
        attempts: 2,
        lastError: 'HTTP 405',
        source: 'fault',
      }));
      await updateBacklogItem('stable-key', {
        title: 'Clearer title',
        detail: 'A much clearer definition of done.',
        kind: 'feature',
        priority: 1,
      });
      expect(stored('stable-key')).toMatchObject({
        slug: 'stable-key',
        title: 'Clearer title',
        detail: 'A much clearer definition of done.',
        kind: 'feature',
        priority: 1,
        attempts: 2,
        lastError: 'HTTP 405',
        source: 'fault',
      });
    });

    it('stores a groomed brief and preserves it when a later edit omits grooming', async () => {
      const created = await createBacklogItem({
        title: 'Structured feature',
        detail: 'rough brief',
        kind: 'feature',
        priority: 2,
        grooming: {
          problem: 'The builder has to guess.',
          outcome: 'The builder receives a contract.',
          acceptanceCriteria: ['The contract is persisted', 'The builder reads it', 'The user reviews it'],
          validation: ['Persistence tests pass'],
          implementationNotes: ['Use additive record JSON'],
          openQuestions: [],
          effort: 'small',
          risk: 'low',
          modelId: 'default-test-model',
          groomedAt: '2026-09-04T09:00:00.000Z',
          revision: 2,
        },
      });
      expect(created.grooming).toMatchObject({
        modelId: 'default-test-model',
        revision: 2,
        readiness: { status: 'ready' },
      });
      expect(created.grooming?.acceptedAt).toBeTruthy();

      await updateBacklogItem(created.slug, {
        title: 'Structured feature renamed',
        detail: 'edited without another grooming pass',
        kind: 'feature',
        priority: 1,
      });
      expect(stored(created.slug).grooming?.revision).toBe(2);
      expect(stored(created.slug).grooming?.problem).toBe('The builder has to guess.');
    });

    it('locks a shipped item to the kind that produced its artifact', async () => {
      seed(item({ slug: 'built', status: 'shipped', kind: 'tool' }));
      await expect(updateBacklogItem('built', {
        title: 'Built', detail: 'still built', kind: 'feature', priority: 2,
      })).rejects.toThrow(/cannot change kind/);
      expect(stored('built').kind).toBe('tool');
      expect(stored('built').status).toBe('shipped');
    });

    it('removes an item as a tombstone so the engine cannot recreate it', async () => {
      seed(item({ slug: 'do-not-return', title: 'Do not return', attempts: 2 }));
      await removeBacklogItem('do-not-return');
      expect(stored('do-not-return')).toMatchObject({
        status: 'abandoned',
        removedBy: 'owner',
      });
      expect(stored('do-not-return').removedAt).toBeTruthy();
      expect(await addIdeas([{ title: 'Do not return', detail: 'again', kind: 'tool' }])).toEqual([]);
    });
  });

  describe('setPriority', () => {
    it('writes the new priority, which is what pickWork ranks on', async () => {
      seed(item({ slug: 'a', priority: 2 }));
      await setPriority('a', 1);
      expect(stored('a').priority).toBe(1);
    });

    it('clamps outside 1..5 rather than storing a value the engine cannot rank', async () => {
      seed(item({ slug: 'a', priority: 3 }));
      await setPriority('a', 0);
      expect(stored('a').priority).toBe(1);
      await setPriority('a', 99);
      expect(stored('a').priority).toBe(5);
    });

    it('reports a missing item instead of writing a new one', async () => {
      await expect(setPriority('nope', 1)).rejects.toThrow(/no backlog item/);
      expect(h.records).toHaveLength(0);
    });
  });

  describe('setParked', () => {
    it('parks as abandoned, the status pickWork already skips', async () => {
      seed(item({ slug: 'a' }));
      await setParked('a', true, 'not worth it');
      expect(stored('a').status).toBe('abandoned');
      expect(stored('a').parkedReason).toBe('not worth it');
      expect(pickWork([stored('a')], 'tool', 3)).toHaveLength(0);
    });

    // The retry budget is the memory of what has been tried. Un-parking is not
    // evidence that the last four failures did not happen.
    it('does not reset attempts when an item is put back', async () => {
      seed(item({ slug: 'a', status: 'abandoned', attempts: 3, parkedReason: 'gave up' }));
      await setParked('a', false);
      expect(stored('a').status).toBe('open');
      expect(stored('a').attempts).toBe(3);
      expect(stored('a').parkedReason).toBeUndefined();
    });
  });

  describe('setEpic', () => {
    it('sets and clears the grouping key', async () => {
      seed(item({ slug: 'a' }));
      await setEpic('a', 'epic:money');
      expect(stored('a').epicSlug).toBe('epic:money');
      await setEpic('a', null);
      expect(stored('a').epicSlug).toBeUndefined();
    });
  });

  describe('pickFoldSurvivor', () => {
    it('keeps the highest priority, then the one with the most history', () => {
      const survivor = pickFoldSurvivor([
        item({ slug: 'low', priority: 4, attempts: 3 }),
        item({ slug: 'best', priority: 1, attempts: 0 }),
        item({ slug: 'mid', priority: 2, attempts: 2 }),
      ]);
      expect(survivor?.slug).toBe('best');
    });

    it('breaks a priority tie toward the item carrying attempts', () => {
      const survivor = pickFoldSurvivor([
        item({ slug: 'fresh', priority: 2, attempts: 0 }),
        item({ slug: 'tried', priority: 2, attempts: 2, lastError: 'HTTP 405' }),
      ]);
      expect(survivor?.slug).toBe('tried');
    });

    it('returns null for an empty set', () => {
      expect(pickFoldSurvivor([])).toBeNull();
    });
  });

  describe('foldItems', () => {
    it('keeps one and abandons the rest with a pointer back', async () => {
      seed(
        item({ slug: 'keep', title: 'Duplicate-charge reconciler', priority: 2, attempts: 1 }),
        item({ slug: 'dupe-a', title: 'Finance duplicate-charge reconciler', priority: 5 }),
        item({ slug: 'dupe-b', title: 'Subscription duplicate-charge monitor', priority: 5 }),
      );
      const res = await foldItems(['keep', 'dupe-a', 'dupe-b']);
      expect(res.survivor).toBe('keep');
      expect(res.folded.sort()).toEqual(['dupe-a', 'dupe-b']);
      expect(stored('keep').foldedCount).toBe(2);
      expect(stored('keep').status).toBe('open');
      for (const s of ['dupe-a', 'dupe-b']) {
        expect(stored(s).status).toBe('abandoned');
        expect(stored(s).foldedInto).toBe('keep');
        expect(stored(s).parkedReason).toContain('Duplicate-charge reconciler');
      }
    });

    // Nothing here deletes. addIdeas checks existence BY KEY, so a surviving
    // row is what stops the same idea being written fresh at attempts: 0
    // tomorrow — deleting the loser would resurrect it.
    it('leaves the folded rows in place so they cannot be re-added', async () => {
      // Seeded under the slugs `addIdeas` would derive from these titles —
      // that is the whole mechanism: existence is checked BY KEY, so the
      // surviving abandoned row is what makes tonight's re-proposal a no-op.
      seed(
        item({ slug: 'local-events-search', title: 'Local events search', priority: 2 }),
        item({ slug: 'local-events-api-tool', title: 'Local events API tool', priority: 5 }),
      );
      await foldItems(['local-events-search', 'local-events-api-tool']);
      expect(h.records).toHaveLength(2);
      const added = await addIdeas([{ title: 'Local events API tool', detail: '', kind: 'tool' }]);
      expect(added).toEqual([]);
      expect(stored('local-events-api-tool').status).toBe('abandoned');
      expect(stored('local-events-api-tool').foldedInto).toBe('local-events-search');
    });

    it('accumulates when the same survivor absorbs a second fold', async () => {
      seed(
        item({ slug: 'keep', priority: 1, title: 'Keep me' }),
        item({ slug: 'a', priority: 5, title: 'A' }),
        item({ slug: 'b', priority: 5, title: 'B' }),
      );
      await foldItems(['keep', 'a']);
      await foldItems(['keep', 'b']);
      expect(stored('keep').foldedCount).toBe(2);
    });

    it('honours an explicit survivor the owner chose', async () => {
      seed(item({ slug: 'a', priority: 1, title: 'A' }), item({ slug: 'b', priority: 5, title: 'B' }));
      const res = await foldItems(['a', 'b'], 'b');
      expect(res.survivor).toBe('b');
      expect(stored('a').foldedInto).toBe('b');
    });

    it('refuses a survivor that is not one of the folded items', async () => {
      seed(item({ slug: 'a', title: 'A' }), item({ slug: 'b', title: 'B' }));
      await expect(foldItems(['a', 'b'], 'c')).rejects.toThrow(/not one of/);
    });

    it('refuses a fold of fewer than two items', async () => {
      seed(item({ slug: 'a', title: 'A' }));
      await expect(foldItems(['a'])).rejects.toThrow(/at least two/);
      await expect(foldItems(['a', 'a'])).rejects.toThrow(/at least two/);
    });
  });
});

// ── Review fixes, 2026-09-04 ──────────────────────────────────────────────

describe('a shipped item is protected from the board', () => {
  beforeEach(() => {
    h.records = [];
    h.keyReadFails = false;
  });
  function seed(...items: BacklogItemData[]) {
    h.records = items.map((i) => ({ key: i.slug, data: i }));
  }
  const stored = (slug: string) => h.records.find((r) => r.key === slug)?.data as BacklogItemData;

  // Parking writes `abandoned`, erasing the only field saying it shipped —
  // and putting it back would write `open`, handing an already-built tool to
  // `pickWork` to be built a second time.
  it('refuses to park it, and leaves the record untouched', async () => {
    seed(item({ slug: 'built', title: 'PayPal transaction history tool', status: 'shipped', attempts: 1 }));
    await expect(setParked('built', true)).rejects.toThrow(/already shipped/);
    expect(stored('built').status).toBe('shipped');
  });

  it('refuses to fold it, and leaves every member untouched', async () => {
    seed(
      item({ slug: 'built', title: 'Subscription renewal calendar', status: 'shipped' }),
      item({ slug: 'open-dupe', title: 'Subscription renewal reminders' }),
    );
    await expect(foldItems(['built', 'open-dupe'])).rejects.toThrow(/already shipped/);
    expect(stored('built').status).toBe('shipped');
    expect(stored('open-dupe').status).toBe('open');
    expect(stored('open-dupe').foldedInto).toBeUndefined();
  });

  it('still folds two open restatements of the same shipped thing', async () => {
    seed(
      item({ slug: 'a', title: 'Subscription renewal reminders', priority: 2 }),
      item({ slug: 'b', title: 'Subscription renewal alerts', priority: 5 }),
    );
    const res = await foldItems(['a', 'b']);
    expect(res.survivor).toBe('a');
    expect(stored('b').status).toBe('abandoned');
  });
});

describe('putting an attempt-exhausted item back', () => {
  beforeEach(() => {
    h.records = [];
    h.keyReadFails = false;
  });
  const stored = (slug: string) => h.records.find((r) => r.key === slug)?.data as BacklogItemData;

  // Without this, "put it back" is a silent no-op: the item is already `open`
  // and still over the ceiling, so it snaps straight back to Parked.
  it('resets the attempt count so pickWork can reach it again', async () => {
    h.records = [{ key: 'spent', data: item({ slug: 'spent', attempts: 4, lastError: 'HTTP 405' }) }];
    await setParked('spent', false);
    expect(stored('spent').status).toBe('open');
    expect(stored('spent').attempts).toBe(0);
    // The failure text survives — it is what the next author call reads.
    expect(stored('spent').lastError).toBe('HTTP 405');
    expect(pickWork([stored('spent')], 'tool', 3)).toHaveLength(1);
  });

  it('leaves the count alone for an item that had attempts left', async () => {
    h.records = [{ key: 'some', data: item({ slug: 'some', status: 'abandoned', attempts: 2 }) }];
    await setParked('some', false);
    expect(stored('some').attempts).toBe(2);
  });
});

describe('bulk edits', () => {
  beforeEach(() => {
    h.records = [];
    h.keyReadFails = false;
  });
  const stored = (slug: string) => h.records.find((r) => r.key === slug)?.data as BacklogItemData;

  it('applies a priority to every slug in one call', async () => {
    h.records = ['a', 'b', 'c'].map((slug) => ({ key: slug, data: item({ slug, priority: 4 }) }));
    const res = await setPriorityMany(['a', 'b', 'c'], 1);
    expect(res.changed.sort()).toEqual(['a', 'b', 'c']);
    expect(res.failed).toEqual([]);
    expect(['a', 'b', 'c'].map((s) => stored(s).priority)).toEqual([1, 1, 1]);
  });

  // Twenty selected duplicates containing one shipped row must not look like
  // a clean success, nor like a total failure.
  it('reports partial failure by slug rather than swallowing it', async () => {
    h.records = [
      { key: 'ok', data: item({ slug: 'ok' }) },
      { key: 'built', data: item({ slug: 'built', title: 'Already built', status: 'shipped' }) },
    ];
    const res = await setParkedMany(['ok', 'built'], true, 'bulk park');
    expect(res.changed).toEqual(['ok']);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].slug).toBe('built');
    expect(res.failed[0].error).toMatch(/already shipped/);
    expect(stored('built').status).toBe('shipped');
  });

  it('de-duplicates a slug sent twice', async () => {
    h.records = [{ key: 'a', data: item({ slug: 'a', priority: 3 }) }];
    const res = await setPriorityMany(['a', 'a'], 2);
    expect(res.changed).toEqual(['a']);
  });
});

// ── The settled stamp and the note thread (2026-09-04, second pass) ────────

describe('settledAt', () => {
  function seed(...items: BacklogItemData[]) {
    h.records = items.map((i) => ({ key: i.slug, data: i }));
  }
  const stored = (slug: string) => h.records.find((r) => r.key === slug)?.data as BacklogItemData;

  it('is stamped when parking takes an item out of the queue', async () => {
    seed(item({ slug: 'p', title: 'P' }));
    await setParked('p', true, 'not now');
    expect(stored('p').settledAt).toBeTruthy();
    expect(stored('p').status).toBe('abandoned');
  });

  it('is cleared when the item comes back to open', async () => {
    // A row carrying both an open status and a settled date is a contradiction
    // the reconstruction would have to guess its way out of.
    seed(item({ slug: 'p', title: 'P' }));
    await setParked('p', true);
    await setParked('p', false);
    expect(stored('p').status).toBe('open');
    expect(stored('p').settledAt).toBeUndefined();
  });

  it('keeps the FIRST stamp when an already-settled row is touched again', async () => {
    // Letting a later write move it would walk every settled item forward to
    // today — the exact `updatedAt` behaviour this field replaces.
    seed(item({ slug: 'p', title: 'P', status: 'abandoned', settledAt: '2026-07-01T00:00:00.000Z' }));
    await setParked('p', true, 'again');
    expect(stored('p').settledAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('is stamped on the losers of a fold and not on the survivor', async () => {
    seed(
      item({ slug: 'keep', title: 'Bank balance', createdAt: '2026-08-01T00:00:00.000Z' }),
      item({ slug: 'drop', title: 'Bank balance via TrueLayer', createdAt: '2026-08-02T00:00:00.000Z' }),
    );
    const res = await foldItems(['keep', 'drop']);
    expect(stored(res.survivor).settledAt).toBeUndefined();
    for (const slug of res.folded) expect(stored(slug).settledAt).toBeTruthy();
  });

  it('is stamped when an attempt ships or abandons, and not while it is still open', async () => {
    seed(item({ slug: 'a', title: 'A' }));
    await markAttempt(item({ slug: 'a', title: 'A' }), { status: 'open', error: 'try again' });
    expect(stored('a').settledAt).toBeUndefined();
    await markAttempt(stored('a'), { status: 'shipped' });
    expect(stored('a').settledAt).toBeTruthy();
  });

  it('is stamped when the owner removes an item', async () => {
    seed(item({ slug: 'r', title: 'R' }));
    await removeBacklogItem('r');
    expect(stored('r').settledAt).toBeTruthy();
  });
});

describe('notes', () => {
  function seed(...items: BacklogItemData[]) {
    h.records = items.map((i) => ({ key: i.slug, data: i }));
  }
  const stored = (slug: string) => h.records.find((r) => r.key === slug)?.data as BacklogItemData;

  it('appends a note without touching anything else on the item', async () => {
    seed(item({ slug: 'n', title: 'N', priority: 2, attempts: 3, lastError: 'boom' }));
    await addBacklogNote('n', '  Ask whether TrueLayer covers joint accounts.  ');
    const after = stored('n');
    expect(after.notes).toHaveLength(1);
    expect(after.notes?.[0].text).toBe('Ask whether TrueLayer covers joint accounts.');
    expect(after.notes?.[0].author).toBe('owner');
    expect(after.priority).toBe(2);
    expect(after.attempts).toBe(3);
    expect(after.lastError).toBe('boom');
  });

  it('refuses an empty note rather than storing a blank row', async () => {
    seed(item({ slug: 'n', title: 'N' }));
    await expect(addBacklogNote('n', '   ')).rejects.toThrow(/needs some text/);
  });

  it('removes one note by id and leaves the rest', async () => {
    seed(item({ slug: 'n', title: 'N' }));
    await addBacklogNote('n', 'first');
    await addBacklogNote('n', 'second');
    const id = stored('n').notes![0].id;
    await removeBacklogNote('n', id);
    expect(stored('n').notes?.map((x) => x.text)).toEqual(['second']);
  });

  it('reports a note it cannot find instead of silently doing nothing', async () => {
    seed(item({ slug: 'n', title: 'N' }));
    await expect(removeBacklogNote('n', 'nope')).rejects.toThrow(/no note/);
  });

  it('keeps the recent end of a long thread', async () => {
    seed(item({ slug: 'n', title: 'N', notes: Array.from({ length: MAX_BACKLOG_NOTES }, (_, i) => ({
      id: `old-${i}`,
      at: '2026-08-01T00:00:00.000Z',
      author: 'owner' as const,
      text: `old ${i}`,
    })) }));
    await addBacklogNote('n', 'the newest thing');
    const notes = stored('n').notes!;
    expect(notes).toHaveLength(MAX_BACKLOG_NOTES);
    expect(notes[notes.length - 1].text).toBe('the newest thing');
    expect(notes[0].text).toBe('old 1');
  });
});

it('runs automatic grooming immediately after both owner and engine intake', async () => {
  vi.mocked(groomAfterIntake).mockClear();
  await addIdeas([{ title: 'Intake automatic engine example', detail: 'retain all requirements', kind: 'feature' }]);
  expect(groomAfterIntake).toHaveBeenCalledTimes(1);
  await createBacklogItem({ title: 'Intake automatic owner example', detail: 'retain all requirements', kind: 'feature', priority: 3 });
  expect(groomAfterIntake).toHaveBeenCalledTimes(2);
});
