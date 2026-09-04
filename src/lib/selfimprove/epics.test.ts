import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ records: new Map<string, Array<{ key: string; data: unknown }>>() }));

/** One fake datastore for both collections — `epics.ts` writes `improvement_epics`
 *  and reaches through `setEpic` into `improvement_backlog`, and a test that
 *  mocked only one of them would prove nothing about the join. */
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
  const rows = (slug: string) => {
    if (!h.records.has(slug)) h.records.set(slug, []);
    return h.records.get(slug)!;
  };
  return {
    DatastoreError,
    getCollectionBySlug: vi.fn().mockResolvedValue({ id: 'c1' }),
    queryRecords: vi.fn(async (slug: string, opts: { limit?: number; offset?: number }) => {
      const limit = Math.min(opts?.limit ?? 100, 500);
      const offset = opts?.offset ?? 0;
      return { records: rows(slug).slice(offset, offset + limit) };
    }),
    getRecordByKey: vi.fn(async (slug: string, key: string) => {
      const found = rows(slug).find((r) => r.key === key);
      if (!found) throw new DatastoreError('not_found', 'absent');
      return found;
    }),
    upsertRecord: vi.fn(async (slug: string, rec: { key: string; data: unknown }) => {
      const list = rows(slug);
      const i = list.findIndex((r) => r.key === rec.key);
      if (i >= 0) list[i] = rec;
      else list.push(rec);
      return { id: rec.key };
    }),
  };
});

import { decideEpic, findThemes, listEpics, toEpic, ungroupEpic } from './epics';
import { clusterSlug } from './cluster';
import type { BacklogItemData, EpicData } from './types';

function item(slug: string, title: string, over: Partial<BacklogItemData> = {}): BacklogItemData {
  return {
    slug,
    title,
    detail: '',
    kind: 'tool',
    status: 'open',
    priority: 2,
    attempts: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

/** Five real ways production asks for one tool. */
const QUEUE = [
  item('a', 'Live OpenRouter account balance API'),
  item('b', 'Live OpenRouter balance'),
  item('c', 'Live OpenRouter balance query'),
  item('d', 'Live OpenRouter balance query via API'),
  item('e', 'OpenRouter account balance API'),
  item('z', 'Tide times for the Norfolk Broads'),
];

function seedBacklog(items: BacklogItemData[]) {
  h.records.set(
    'improvement_backlog',
    items.map((i) => ({ key: i.slug, data: i })),
  );
}
const backlogRow = (slug: string) =>
  (h.records.get('improvement_backlog') ?? []).find((r) => r.key === slug)?.data as BacklogItemData;
const epicRow = (slug: string) =>
  (h.records.get('improvement_epics') ?? []).find((r) => r.key === slug)?.data as EpicData;

beforeEach(() => {
  h.records = new Map();
  vi.clearAllMocks();
});

describe('findThemes', () => {
  it('writes a proposal for each new theme and skips the lone item', async () => {
    seedBacklog(QUEUE);
    const res = await findThemes();
    expect(res.proposed.length).toBeGreaterThan(0);
    const members = res.proposed.flatMap((e) => e.memberSlugs);
    expect(members).not.toContain('z');
    expect(await listEpics()).toHaveLength(res.proposed.length);
  });

  it('proposes nothing new on a second run over an unchanged queue', async () => {
    seedBacklog(QUEUE);
    const first = await findThemes();
    const second = await findThemes();
    expect(second.proposed).toEqual([]);
    expect(second.known).toBe(first.proposed.length);
  });

  // The rule `daydream_capabilities` was written under: the 19-29 Jul runs
  // re-proposed "news digest" ten nights running because nothing recorded a no.
  it('never re-proposes a theme the owner declined', async () => {
    seedBacklog(QUEUE);
    const [theme] = (await findThemes()).proposed;
    await decideEpic(theme.slug, 'decline');
    const again = await findThemes();
    expect(again.proposed.map((e) => e.slug)).not.toContain(theme.slug);
    expect(again.declined).toBe(1);
    expect(epicRow(theme.slug).status).toBe('declined');
  });

  it('does not propose a theme whose open members have all gone', async () => {
    seedBacklog([
      item('a', 'Live OpenRouter balance', { status: 'shipped' }),
      item('b', 'Live OpenRouter balance query', { status: 'shipped' }),
      item('c', 'Live OpenRouter account balance API', { status: 'shipped' }),
    ]);
    const res = await findThemes();
    expect(res.proposed).toEqual([]);
  });

  it('honours a proposal cap', async () => {
    seedBacklog([
      ...QUEUE,
      item('p', 'Delivery-status monitoring and alerts'),
      item('q', 'Delivery-status monitoring'),
      item('r', 'Delivery status monitoring with alerts'),
    ]);
    const res = await findThemes({ maxProposals: 1 });
    expect(res.proposed).toHaveLength(1);
  });

  it('survives an empty queue', async () => {
    seedBacklog([]);
    const res = await findThemes();
    expect(res.proposed).toEqual([]);
    expect(res.clusters).toBe(0);
  });
});

describe('decideEpic', () => {
  it('accepting groups every member, so the board swimlanes light up', async () => {
    seedBacklog(QUEUE);
    const [theme] = (await findThemes()).proposed;
    const res = await decideEpic(theme.slug, 'accept');
    expect(res.status).toBe('accepted');
    expect(res.grouped.sort()).toEqual([...theme.memberSlugs].sort());
    expect(res.failed).toEqual([]);
    for (const m of theme.memberSlugs) expect(backlogRow(m).epicSlug).toBe(theme.slug);
    expect(epicRow(theme.slug).decidedBy).toBe('owner');
  });

  // Two different judgements. "These are about the same subject" is a
  // grouping; "these say the same thing" is a fold that abandons rows. A
  // matcher is trusted with the first and never with the second.
  it('accepting groups but never abandons anything', async () => {
    seedBacklog(QUEUE);
    const [theme] = (await findThemes()).proposed;
    await decideEpic(theme.slug, 'accept');
    for (const m of theme.memberSlugs) {
      expect(backlogRow(m).status).toBe('open');
      expect(backlogRow(m).foldedInto).toBeUndefined();
    }
  });

  it('declining writes no grouping at all', async () => {
    seedBacklog(QUEUE);
    const [theme] = (await findThemes()).proposed;
    const res = await decideEpic(theme.slug, 'decline');
    expect(res.grouped).toEqual([]);
    for (const m of theme.memberSlugs) expect(backlogRow(m).epicSlug).toBeUndefined();
  });

  it('reports a member it could not group rather than failing the whole theme', async () => {
    seedBacklog(QUEUE);
    const [theme] = (await findThemes()).proposed;
    // A member that vanished from the queue between proposal and decision.
    const gone = theme.memberSlugs[0];
    h.records.set(
      'improvement_backlog',
      (h.records.get('improvement_backlog') ?? []).filter((r) => r.key !== gone),
    );
    const res = await decideEpic(theme.slug, 'accept');
    expect(res.failed.map((f) => f.slug)).toEqual([gone]);
    expect(res.grouped.length).toBe(theme.memberSlugs.length - 1);
    expect(epicRow(theme.slug).status).toBe('accepted');
  });

  it('refuses a theme that does not exist', async () => {
    await expect(decideEpic('epic:9-nope', 'accept')).rejects.toThrow(/no such theme/);
  });
});

describe('ungroupEpic', () => {
  it('clears the grouping and puts the theme back for a fresh decision', async () => {
    seedBacklog(QUEUE);
    const [theme] = (await findThemes()).proposed;
    await decideEpic(theme.slug, 'accept');
    const res = await ungroupEpic(theme.slug);
    expect(res.status).toBe('proposed');
    for (const m of theme.memberSlugs) expect(backlogRow(m).epicSlug).toBeUndefined();
    expect(epicRow(theme.slug).status).toBe('proposed');
    expect(epicRow(theme.slug).decidedBy).toBeUndefined();
  });
});

describe('review fixes, 2026-09-04', () => {
  // `stageFor` maps a shipped row to `verifying` when its tool has never been
  // called — 32 tools of 79 here — so the card cannot ask the board whether a
  // member shipped. The split is recorded at proposal time instead.
  it('records the open/shipped split, so a card need not re-derive it', async () => {
    seedBacklog([
      item('a', 'Live OpenRouter balance'),
      item('b', 'Live OpenRouter balance query'),
      item('c', 'Live OpenRouter account balance API', { status: 'shipped' }),
    ]);
    const [theme] = (await findThemes()).proposed;
    expect(theme.shippedSlugs).toEqual(['c']);
    expect(theme.openSlugs.sort()).toEqual(['a', 'b']);
  });

  // The cap limits how many rulings the room ASKS for. Breaking out of the
  // loop also stopped the counters, so the nightly line reported off partials.
  it('keeps counting past the proposal cap', async () => {
    seedBacklog([
      item('a', 'Live OpenRouter balance'),
      item('b', 'Live OpenRouter balance query'),
      item('p', 'Delivery-status monitoring and alerts'),
      item('q', 'Delivery-status monitoring'),
      item('r', 'Delivery status monitoring with alerts'),
    ]);
    const res = await findThemes({ maxProposals: 1 });
    expect(res.proposed).toHaveLength(1);
    expect(res.uncapped).toBeGreaterThan(0);
  });

  // Memberships shift run to run, and a stale theme must not strip a newer
  // one's grouping off the rows they share.
  it('ungrouping a stale theme leaves a newer theme’s grouping alone', async () => {
    seedBacklog([item('a', 'Live OpenRouter balance'), item('b', 'Live OpenRouter balance query')]);
    const [stale] = (await findThemes()).proposed;
    await decideEpic(stale.slug, 'accept');
    // A newer theme takes the same rows.
    for (const m of stale.memberSlugs) {
      const row = backlogRow(m);
      (h.records.get('improvement_backlog') ?? []).find((r) => r.key === m)!.data = {
        ...row,
        epicSlug: 'epic:9-newer',
      };
    }
    await ungroupEpic(stale.slug);
    for (const m of stale.memberSlugs) expect(backlogRow(m).epicSlug).toBe('epic:9-newer');
  });

  it('ungrouping still clears the rows the theme actually owns', async () => {
    seedBacklog([item('a', 'Live OpenRouter balance'), item('b', 'Live OpenRouter balance query')]);
    const [theme] = (await findThemes()).proposed;
    await decideEpic(theme.slug, 'accept');
    await ungroupEpic(theme.slug);
    for (const m of theme.memberSlugs) expect(backlogRow(m).epicSlug).toBeUndefined();
  });

  // Writes are soft in this engine; reads are not. A room that cannot load its
  // ledger must say so rather than assert there is nothing in it.
  it('a failed read throws rather than reporting an empty ledger', async () => {
    const ds = await import('$lib/datastore');
    vi.mocked(ds.queryRecords).mockRejectedValueOnce(new Error('database is on fire'));
    await expect(listEpics()).rejects.toThrow(/on fire/);
  });
});

describe('toEpic', () => {
  it('carries the cluster verbatim and names every score input', () => {
    const epic = toEpic(
      {
        slug: clusterSlug(['a', 'b']),
        label: 'Live OpenRouter balance',
        keywords: ['openrouter', 'balance'],
        memberSlugs: ['a', 'b'],
        openSlugs: ['a', 'b'],
        shippedSlugs: [],
        servedCount: 1,
      },
      '2026-09-04T00:00:00.000Z',
    );
    expect(epic.label).toBe('Live OpenRouter balance');
    expect(epic.status).toBe('proposed');
    expect(Object.keys(epic.components).sort()).toEqual(['served', 'shipped', 'size']);
    expect(epic.createdAt).toBe('2026-09-04T00:00:00.000Z');
  });
});
