import { beforeEach, describe, expect, it, vi } from 'vitest';

// Slice 7b: the capability-gap queue. One record per conversation and twin,
// drained onto the backlog as source 'capability-gap' after the chat call,
// with the ask kept as quoted data. Synthetic data; an in-memory datastore.

const h = vi.hoisted(() => ({
  store: new Map<string, { key: string; data: Record<string, unknown>; createdAt: Date }>(),
  intakes: [] as Array<Record<string, unknown>>,
  slugs: new Map<string, number>(),
}));

vi.mock('$lib/datastore', () => ({
  ensureCollection: async () => ({ id: 'c' }),
  getRecordByKey: async (_c: string, key: string) => h.store.get(key) ?? null,
  upsertRecord: async (_c: string, input: { key: string; data: Record<string, unknown> }) => {
    const prev = h.store.get(input.key);
    h.store.set(input.key, { key: input.key, data: input.data, createdAt: prev?.createdAt ?? new Date() });
  },
  queryRecords: async () => ({ records: [...h.store.values()].filter((r) => r.data.status === 'queued') }),
}));
vi.mock('./backlog', () => ({
  intakeIdeas: async (ideas: Array<Record<string, unknown>>) => {
    h.intakes.push(...ideas);
    const title = String(ideas[0].title);
    const seen = h.slugs.get(title) ?? 0;
    h.slugs.set(title, seen + 1);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return seen ? { added: [], merged: [{ title, into: slug, exact: true }], capped: 0, outcomes: ['merged'] } : { added: [slug], merged: [], capped: 0, outcomes: ['added'] };
  },
}));

import { drainCapabilityGaps, enqueueCapabilityGap, gapKey } from './capability-gaps';

const gap = (conversationId: string, query = 'show me the family photos') => ({ capabilityId: 'family', title: 'jkai capability: Family features from chat', query, conversationId });

beforeEach(() => {
  h.store.clear();
  h.intakes.length = 0;
  h.slugs.clear();
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
    expect(h.intakes[0]).toMatchObject({ source: 'capability-gap', kind: 'feature', ref: 'conv:c1', title: 'jkai capability: Family features from chat' });
    expect(String(h.intakes[0].detail)).toContain('The ask, quoted: "show me the family photos"');

    await enqueueCapabilityGap(gap('c2'), { drainSoon: false });
    await drainCapabilityGaps();
    const rows = [...h.store.values()].map((r) => r.data);
    expect(rows.map((r) => r.status).sort()).toEqual(['added', 'merged']);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(1);
    // Drained rows are not taken twice.
    expect(await drainCapabilityGaps()).toBe(0);
  });
});
