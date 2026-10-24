import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareVisit } from './share-visitor';

/**
 * Writing and reading the visitor rows, with the database as a queue of
 * answers. The real SQL runs in share-visits.integration.test.ts.
 */

const state = vi.hoisted(() => ({
  updated: [] as unknown[][],
  executed: [] as unknown[],
  sets: [] as Record<string, unknown>[],
  results: [] as unknown[],
}));

vi.mock('$lib/db', () => {
  const update = () => {
    const chain = {
      set: (v: Record<string, unknown>) => (state.sets.push(v), chain),
      where: () => chain,
      returning: async () => (state.updated.shift() ?? []) as unknown[],
    };
    return chain;
  };
  return {
    db: {
      update,
      execute: async (q: unknown) => {
        state.executed.push(q);
        return state.results.shift() ?? { rows: [] };
      },
    },
  };
});

const { recordShareVisit, shareVisitStats } = await import('./share-visits');

beforeEach(() => {
  state.updated.length = 0;
  state.executed.length = 0;
  state.sets.length = 0;
  state.results.length = 0;
});

const visit = (over: Partial<ShareVisit> = {}): ShareVisit => ({
  open: true,
  visitorHash: 'h'.repeat(32),
  networkHash: 'n'.repeat(16),
  agent: 'Chrome · Windows',
  country: 'GB',
  ...over,
});

describe('recording a visit', () => {
  it('updates a known visitor and adds nothing', async () => {
    state.updated.push([{ id: 'v1' }]);
    await recordShareVisit('s1', visit());
    expect(state.sets).toHaveLength(1);
    expect(state.sets[0]).toMatchObject({ agent: 'Chrome · Windows', country: 'GB' });
    expect(state.executed).toHaveLength(0);
  });

  it('adds someone new on a page open, under the row cap', async () => {
    await recordShareVisit('s1', visit());
    expect(state.executed).toHaveLength(1);
    const text = JSON.stringify(state.executed[0]);
    expect(text).toContain('on conflict (share_id, visitor_hash, network_hash)');
    expect(text).toContain('< ');
  });

  it("never adds someone from a page's own data request", async () => {
    await recordShareVisit('s1', visit({ open: false }));
    expect(state.sets).toHaveLength(1);
    expect(state.executed).toHaveLength(0);
  });

  it('keeps the last known agent and country when this request has none', async () => {
    state.updated.push([{ id: 'v1' }]);
    await recordShareVisit('s1', visit({ agent: null, country: null }));
    expect(state.sets[0]).not.toHaveProperty('agent');
    expect(state.sets[0]).not.toHaveProperty('country');
  });

  it('records no one when there was nothing to tell them apart by', async () => {
    await recordShareVisit('s1', visit({ visitorHash: null }));
    expect(state.sets).toHaveLength(0);
    expect(state.executed).toHaveLength(0);
  });
});

describe('reading the stats', () => {
  it('asks two queries for every link of a project and shapes each link, never with a hash', async () => {
    state.results.push(
      {
        rows: [
          { share_id: 's1', rows: '4', opens: '9', browsers: '3', networks: '2', countries: ['IE', 'GB'] },
          { share_id: 's2', rows: 1, opens: 0, browsers: 0, networks: 0, countries: null },
        ],
      },
      {
        rows: [
          { share_id: 's1', browser: '3', network: '2', agent: 'Safari · iPhone', country: 'IE', opens: 2, first_seen: '2026-10-23T09:00:00Z', last_seen: '2026-10-24T09:00:00Z' },
          { share_id: 's1', browser: 1, network: 1, agent: 'Chrome · Windows', country: 'GB', opens: 5, first_seen: new Date('2026-10-22T09:00:00Z'), last_seen: new Date('2026-10-23T09:00:00Z') },
          { share_id: 's2', browser: null, network: null, agent: 'Preview · WhatsApp', country: null, opens: 1, first_seen: '2026-10-22T08:00:00Z', last_seen: '2026-10-22T08:00:00Z' },
        ],
      },
    );
    const stats = await shareVisitStats('spine', [
      { id: 's1', useCount: 40 },
      { id: 's2', useCount: 3 },
      { id: 's3', useCount: 5 },
    ]);
    expect(state.executed).toHaveLength(2);
    expect(stats.get('s1')).toMatchObject({ opens: 9, browsers: 3, networks: 2, countries: ['GB', 'IE'], likelyForwarded: true, hidden: 2 });
    expect(stats.get('s1')!.visitors.map((v) => [v.browser, v.network, v.agent])).toEqual([
      [3, 'B', 'Safari · iPhone'],
      [1, 'A', 'Chrome · Windows'],
    ]);
    expect(stats.get('s1')!.visitors[0].firstSeen).toBeInstanceOf(Date);
    // Only a previewer came: no one opened it, and its count says so.
    expect(stats.get('s2')).toMatchObject({ opens: 0, browsers: 0, likelyForwarded: false });
    // Nothing recorded yet: the link's own count.
    expect(stats.get('s3')).toMatchObject({ opens: 5, browsers: 0, visitors: [] });
    expect(JSON.stringify([...stats.values()])).not.toMatch(/hash|[0-9a-f]{16}/);
  });

  it('asks nothing for a project with no links', async () => {
    expect((await shareVisitStats('spine', [])).size).toBe(0);
    expect(state.executed).toHaveLength(0);
  });
});
