import { beforeEach, describe, expect, it, vi } from 'vitest';

// Slice 7b: the capability-gap queue. One record per conversation and twin,
// drained onto the backlog as source 'capability-gap' after the chat call,
// with the ask kept as quoted data. Synthetic data.
//
// The backlog half is the REAL `intakeIdeas` (merge, twin detection and the
// daily cap), over an in-memory datastore: only the storage and the grooming
// pass after an addition are faked.

type Row = { key: string; data: Record<string, unknown>; createdAt: Date };
const h = vi.hoisted(() => ({
  collections: new Map<string, Map<string, Row>>(),
  grooms: 0,
}));

function coll(slug: string): Map<string, Row> {
  let c = h.collections.get(slug);
  if (!c) h.collections.set(slug, (c = new Map()));
  return c;
}
const at = (data: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], data);

vi.mock('$lib/datastore', () => ({
  ensureCollection: async (slug: string) => (coll(slug), { id: slug }),
  getCollectionBySlug: async (slug: string) => (h.collections.has(slug) ? { id: slug, slug } : null),
  getRecordByKey: async (slug: string, key: string) => h.collections.get(slug)?.get(key) ?? null,
  upsertRecord: async (slug: string, input: { key: string; data: Record<string, unknown> }) => {
    const c = coll(slug);
    const prev = c.get(input.key);
    c.set(input.key, { key: input.key, data: input.data, createdAt: prev?.createdAt ?? new Date() });
  },
  queryRecords: async (
    slug: string,
    q: { filters?: Array<{ path: string; op: string; value: unknown }>; limit?: number; offset?: number } = {},
  ) => {
    let rows = [...(h.collections.get(slug)?.values() ?? [])];
    for (const f of q.filters ?? []) if (f.op === 'eq') rows = rows.filter((r) => at(r.data, f.path) === f.value);
    const offset = q.offset ?? 0;
    return { records: rows.slice(offset, offset + (q.limit ?? 1000)), total: rows.length };
  },
}));
vi.mock('./backlog-room.server', () => ({ groomAfterIntake: async () => void h.grooms++ }));

const { drainCapabilityGaps, enqueueCapabilityGap, gapKey, CAPABILITY_GAP_COLLECTION, GAP_CAPPED_RETRY_MS } = await import('./capability-gaps');
const { MAX_NEW_IDEAS_PER_NIGHT } = await import('./backlog');
const { COLLECTIONS } = await import('./types');

const gap = (conversationId: string, query = 'show me the family photos') => ({ capabilityId: 'family', title: 'jkai capability: Family features from chat', query, conversationId });
const gaps = () => [...(h.collections.get(CAPABILITY_GAP_COLLECTION)?.values() ?? [])].map((r) => r.data);
const backlog = () => [...(h.collections.get(COLLECTIONS.backlog)?.values() ?? [])].map((r) => r.data);

/** A day's worth of fresh, unrelated ideas already on the backlog: the cap is spent. */
function fillTodaysBudget(): void {
  const now = new Date().toISOString();
  const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november'];
  for (let i = 0; i < MAX_NEW_IDEAS_PER_NIGHT; i++) {
    const slug = `unrelated-${words[i]}-zebra-${i}`;
    coll(COLLECTIONS.backlog).set(slug, { key: slug, createdAt: new Date(), data: { slug, title: `Unrelated ${words[i]} zebra ${i}`, detail: '', kind: 'feature', status: 'open', priority: 3, attempts: 0, source: 'think', createdAt: now, updatedAt: now } });
  }
}

beforeEach(() => {
  h.collections.clear();
  h.grooms = 0;
  vi.useRealTimers();
});

describe('capability gap queue', () => {
  it('keys one filing per conversation and twin', () => {
    expect(gapKey(gap('c1'))).toBe(gapKey(gap('c1', 'family photos please')));
    expect(gapKey(gap('c1'))).not.toBe(gapKey(gap('c2')));
    expect(gapKey({ capabilityId: null, query: 'Book my MOT', conversationId: 'c1' })).toBe('c1--book-my-mot');
  });

  it('queues once per conversation, and a second conversation merges on the backlog', async () => {
    expect(await enqueueCapabilityGap(gap('c1'), { drainSoon: false })).toEqual({ status: 'queued' });
    expect((await enqueueCapabilityGap(gap('c1'), { drainSoon: false })).status).toBe('already-queued');
    expect(await drainCapabilityGaps()).toBe(1);
    const [item] = backlog();
    expect(item).toMatchObject({ source: 'capability-gap', kind: 'feature', title: 'jkai capability: Family features from chat', status: 'open' });
    expect(String(item.detail)).toContain('The ask, quoted: "show me the family photos"');
    expect(h.grooms).toBe(1);

    await enqueueCapabilityGap(gap('c2'), { drainSoon: false });
    await drainCapabilityGaps();
    expect(gaps().map((r) => r.status).sort()).toEqual(['added', 'merged']);
    expect(new Set(gaps().map((r) => r.slug)).size).toBe(1);
    // One backlog item, cited twice.
    expect(backlog()).toHaveLength(1);
    expect((backlog()[0].citations as unknown[]).length).toBe(2);
    // Drained rows are not taken twice.
    expect(await drainCapabilityGaps()).toBe(0);
  });

  it('keeps a gap the daily cap turned away queued, and files it on a later sweep', async () => {
    fillTodaysBudget();
    await enqueueCapabilityGap(gap('c1', 'book my MOT'), { drainSoon: false });
    await drainCapabilityGaps();
    const [held] = gaps();
    expect(held.status).toBe('queued');
    expect(held.cappedCount).toBe(1);
    expect(Date.parse(String(held.retryAfter))).toBeGreaterThan(Date.now());
    expect(backlog()).toHaveLength(MAX_NEW_IDEAS_PER_NIGHT);

    // Too soon: the sweep leaves it alone.
    await drainCapabilityGaps();
    expect(gaps()[0].cappedCount).toBe(1);

    // A day and the retry wait later, the budget is back and it lands.
    vi.useFakeTimers({ now: Date.now() + 24 * 60 * 60_000 + GAP_CAPPED_RETRY_MS });
    await drainCapabilityGaps();
    expect(gaps()[0]).toMatchObject({ status: 'added' });
    expect(gaps()[0].retryAfter).toBeUndefined();
    expect(backlog()).toHaveLength(MAX_NEW_IDEAS_PER_NIGHT + 1);
  });
});
