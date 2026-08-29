import { describe, it, expect } from 'vitest';
import {
  reconcileClusters,
  jaccard,
  fingerprint,
  nameDrift,
  MIN_TRACKED_SIZE,
  DELTA_SAMPLE,
  type StoredCluster,
} from './cluster-identity';

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** Deterministic key mint, so a test never depends on randomness. */
function mint() {
  let n = 0;
  return () => `cl_${++n}`;
}

const NOW = '2026-08-14T00:00:00.000Z';
const base = { labelFor: (m: string[]) => m[0], now: NOW };

function stored(over: Partial<StoredCluster> & Pick<StoredCluster, 'key' | 'members'>): StoredCluster {
  return {
    name: null,
    autoLabel: over.members[0] ?? '',
    colourIndex: 0,
    size: over.members.length,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    narrative: null,
    narrativeAt: null,
    narrativeFingerprint: null,
    mergedFrom: [],
    splitFrom: null,
    live: true,
    delta: null,
    namedAt: null,
    namedMembers: null,
    ...over,
  };
}

describe('delta', () => {
  it('is null for a cluster that has just appeared', () => {
    const r = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: [],
      mintKey: mint(),
    });
    expect(r.clusters[0].delta).toBeNull();
  });

  it('records exactly what arrived and what left', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: [],
      mintKey: mint(),
    });
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, [...ids('a', 8), 'x', 'y', 'z']]]),
      stored: first.clusters,
      mintKey: mint(),
    });
    const delta = second.clusters[0].delta!;
    expect(delta.joined).toEqual(['x', 'y', 'z']);
    expect(delta.left).toEqual(['a8', 'a9']);
    expect(delta.joinedCount).toBe(3);
    expect(delta.leftCount).toBe(2);
    expect(delta.at).toBe(NOW);
  });

  it('caps the id lists but not the counts', () => {
    // A big intake that is still recognisably the same cluster — 100 members
    // taking on 60 is well inside the match threshold.
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 100)]]),
      stored: [],
      mintKey: mint(),
    });
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, [...ids('a', 100), ...ids('n', 60)]]]),
      stored: first.clusters,
      mintKey: mint(),
    });
    const delta = second.clusters[0].delta!;
    expect(delta.joined).toHaveLength(DELTA_SAMPLE);
    expect(delta.joinedCount).toBe(60);
  });

  it('keeps the last real change through a reconcile that moves nothing', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: [],
      mintKey: mint(),
    });
    const changed = reconcileClusters({
      ...base,
      detected: new Map([[0, [...ids('a', 10), 'x']]]),
      stored: first.clusters,
      mintKey: mint(),
    });
    const quiet = reconcileClusters({
      ...base,
      now: '2026-08-20T00:00:00.000Z',
      detected: new Map([[0, [...ids('a', 10), 'x']]]),
      stored: changed.clusters,
      mintKey: mint(),
    });
    expect(quiet.clusters[0].delta).toEqual(changed.clusters[0].delta);
  });
});

describe('nameDrift', () => {
  it('is null for a cluster nobody has named', () => {
    expect(nameDrift(stored({ key: 'k', members: ids('a', 5) }))).toBeNull();
  });

  it('is 0 while the cluster is still what was named', () => {
    const members = ids('a', 10);
    expect(nameDrift({ name: 'mine', namedMembers: members, members })).toBe(0);
  });

  it('rises as the cluster walks away from the body it was named on', () => {
    // The real case: a week of chained matches turned one retail cluster into
    // another while it kept its key.
    const drift = nameDrift({
      name: 'SKECHERS',
      namedMembers: ids('a', 158),
      members: [...ids('a', 30), ...ids('z', 162)],
    })!;
    expect(drift).toBeGreaterThan(0.5);
  });
});

describe('fingerprint', () => {
  it('is order-independent', () => {
    expect(fingerprint(['b', 'a'])).toBe(fingerprint(['a', 'b']));
  });

  it('changes when a member joins', () => {
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['a', 'b', 'c']));
  });
});

describe('jaccard', () => {
  it('is 1 for identical sets and 0 for disjoint ones', () => {
    expect(jaccard(new Set(['a', 'b']), ['a', 'b'])).toBe(1);
    expect(jaccard(new Set(['a']), ['b'])).toBe(0);
  });

  it('is 0 for two empty sets rather than NaN', () => {
    expect(jaccard(new Set(), [])).toBe(0);
  });
});

describe('reconcileClusters', () => {
  it('mints a key for every tracked cluster on a cold start', () => {
    const r = reconcileClusters({
      ...base,
      detected: new Map([
        [0, ids('a', 10)],
        [1, ids('b', 8)],
      ]),
      stored: [],
      mintKey: mint(),
    });
    expect(r.clusters).toHaveLength(2);
    expect(r.changes.created).toEqual(['cl_1', 'cl_2']);
    expect(r.keyByIndex.get(0)).toBe('cl_1');
  });

  it('gives distinct colour slots to clusters alive at the same time', () => {
    const r = reconcileClusters({
      ...base,
      detected: new Map([
        [0, ids('a', 10)],
        [1, ids('b', 8)],
        [2, ids('c', 7)],
      ]),
      stored: [],
      mintKey: mint(),
    });
    expect(new Set(r.clusters.map((c) => c.colourIndex)).size).toBe(3);
  });

  it('keeps the key when the community index changes but the members do not', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([
        [0, ids('a', 10)],
        [1, ids('b', 8)],
      ]),
      stored: [],
      mintKey: mint(),
    });
    // The same two bodies, indices swapped — exactly what a nightly sweep does
    // to 70% of the production graph.
    const second = reconcileClusters({
      ...base,
      detected: new Map([
        [0, ids('b', 8)],
        [1, ids('a', 10)],
      ]),
      stored: first.clusters,
      mintKey: mint(),
    });
    expect(second.keyByIndex.get(1)).toBe('cl_1');
    expect(second.keyByIndex.get(0)).toBe('cl_2');
    expect(second.changes.created).toEqual([]);
    expect(second.changes.matched.sort()).toEqual(['cl_1', 'cl_2']);
  });

  it('keeps a user name and its colour across a recompute that churns 20% of members', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 20)]]),
      stored: [],
      mintKey: mint(),
    });
    const renamed = first.clusters.map((c) => ({ ...c, name: 'DfE work' }));
    const churned = [...ids('a', 16), ...ids('z', 4)];
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, churned]]),
      stored: renamed,
      mintKey: mint(),
    });
    expect(second.clusters[0].name).toBe('DfE work');
    expect(second.clusters[0].key).toBe('cl_1');
    expect(second.clusters[0].colourIndex).toBe(renamed[0].colourIndex);
    expect(second.clusters[0].members).toEqual(churned);
    expect(second.clusters[0].size).toBe(20);
  });

  it('preserves what the user named the cluster on, so drift stays measurable', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 20)]]),
      stored: [],
      mintKey: mint(),
    });
    const namedOn = first.clusters[0].members;
    const renamed = first.clusters.map((c) => ({
      ...c,
      name: 'DfE work',
      namedAt: NOW,
      namedMembers: namedOn,
    }));
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, [...ids('a', 14), ...ids('z', 10)]]]),
      stored: renamed,
      mintKey: mint(),
    });
    expect(second.clusters[0].namedMembers).toEqual(namedOn);
    expect(second.clusters[0].namedAt).toBe(NOW);
    expect(nameDrift(second.clusters[0])).toBeGreaterThan(0);
  });

  it('refreshes the auto label but never the user name', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: [],
      mintKey: mint(),
    });
    const renamed = first.clusters.map((c) => ({ ...c, name: 'mine' }));
    const second = reconcileClusters({
      ...base,
      labelFor: () => 'a fresh label',
      detected: new Map([[0, ids('a', 10)]]),
      stored: renamed,
      mintKey: mint(),
    });
    expect(second.clusters[0].name).toBe('mine');
    expect(second.clusters[0].autoLabel).toBe('a fresh label');
  });

  it('keeps a narrative through a member change, leaving its fingerprint stale', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: [],
      mintKey: mint(),
    });
    const withNarrative = first.clusters.map((c) => ({
      ...c,
      narrative: 'words',
      narrativeFingerprint: fingerprint(c.members),
    }));
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, [...ids('a', 10), 'newcomer']]]),
      stored: withNarrative,
      mintKey: mint(),
    });
    expect(second.clusters[0].narrative).toBe('words');
    expect(second.clusters[0].narrativeFingerprint).not.toBe(
      fingerprint(second.clusters[0].members),
    );
  });

  it('does not let two stored clusters claim the same detected one', () => {
    const existing = [
      stored({ key: 'cl_1', name: 'one', members: ids('a', 10), colourIndex: 0 }),
      stored({ key: 'cl_2', name: 'two', members: ids('a', 9), colourIndex: 1 }),
    ];
    const r = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: existing,
      mintKey: mint(),
    });
    const live = r.clusters.filter((c) => c.live);
    expect(live).toHaveLength(1);
    expect(live[0].key).toBe('cl_1');
    expect(live[0].mergedFrom).toContain('cl_2');
    expect(r.clusters.find((c) => c.key === 'cl_2')!.live).toBe(false);
    expect(r.changes.merged).toEqual(['cl_1']);
  });

  // Production, 2026-08-29: `POST /api/jkai/intel/clusters {action:'recalculate'}`
  // returned 500 with "Cannot read properties of undefined (reading 'members')",
  // and every surface that reads the roster had been failing quietly for three
  // days with it. The cluster was `d0db6f86` "Brett Murphy · House of Lords":
  // it lost community #13 to a better overlap and then won #24 outright, so the
  // winner of #13 retired it and deleted it from `byKey` twelve iterations
  // before #24 came to read it.
  //
  // `indexForKey` cannot prevent this on its own — it is only set when a key
  // CLAIMS a body, and at the moment a key is filed as a loser the claim it will
  // make later has not happened yet.
  it('does not absorb a cluster that goes on to win a body of its own', () => {
    const existing = [
      // Takes community 0 outright.
      stored({ key: 'cl_1', members: ids('a', 10) }),
      // Overlaps community 0 at 0.43 — enough to be a would-be merge, but it
      // loses to cl_1 — and community 1 at 0.36, which it wins.
      stored({ key: 'cl_2', members: [...ids('a', 6), ...ids('b', 4)] }),
    ];
    const r = reconcileClusters({
      ...base,
      detected: new Map([
        [0, ids('a', 10)],
        [1, ids('b', 5)],
      ]),
      stored: existing,
      mintKey: mint(),
    });

    const live = r.clusters.filter((c) => c.live);
    expect(live.map((c) => c.key).sort()).toEqual(['cl_1', 'cl_2']);
    // Still here, so nothing absorbed it and nothing retired it.
    expect(r.clusters.filter((c) => c.key === 'cl_2')).toHaveLength(1);
    expect(r.clusters.find((c) => c.key === 'cl_1')!.mergedFrom).toEqual([]);
    expect(r.changes.merged).toEqual([]);
    expect(r.changes.retired).toEqual([]);
    expect(r.keyByIndex.get(1)).toBe('cl_2');
  });

  it('retires a cluster that has gone, without deleting its record', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([
        [0, ids('a', 10)],
        [1, ids('b', 8)],
      ]),
      stored: [],
      mintKey: mint(),
    });
    const named = first.clusters.map((c) => (c.key === 'cl_2' ? { ...c, name: 'kept' } : c));
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: named,
      mintKey: mint(),
    });
    const gone = second.clusters.find((c) => c.key === 'cl_2')!;
    expect(gone.live).toBe(false);
    expect(gone.name).toBe('kept');
    expect(second.changes.retired).toEqual(['cl_2']);
  });

  it('revives a retired cluster rather than minting a second key for it', () => {
    const away = [stored({ key: 'cl_1', name: 'seasonal', members: ids('a', 10), live: false })];
    const r = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: away,
      mintKey: mint(),
    });
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0].key).toBe('cl_1');
    expect(r.clusters[0].live).toBe(true);
    expect(r.clusters[0].name).toBe('seasonal');
    expect(r.changes.created).toEqual([]);
  });

  it('records where a genuinely new cluster split from', () => {
    const twenty = ids('a', 20);
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, twenty]]),
      stored: [],
      mintKey: mint(),
    });
    const second = reconcileClusters({
      ...base,
      detected: new Map([
        [0, twenty.slice(0, 12)],
        [1, twenty.slice(12)],
      ]),
      stored: first.clusters,
      mintKey: mint(),
    });
    const fresh = second.clusters.find((c) => c.key !== 'cl_1')!;
    expect(fresh.splitFrom).toBe('cl_1');
    expect(second.changes.split).toEqual([fresh.key]);
    expect(second.clusters.find((c) => c.key === 'cl_1')!.live).toBe(true);
  });

  it('leaves splitFrom null for a cluster that overlaps nothing', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 20)]]),
      stored: [],
      mintKey: mint(),
    });
    const second = reconcileClusters({
      ...base,
      detected: new Map([
        [0, ids('a', 20)],
        [1, ids('q', 9)],
      ]),
      stored: first.clusters,
      mintKey: mint(),
    });
    expect(second.clusters.find((c) => c.key !== 'cl_1')!.splitFrom).toBeNull();
  });

  it('ignores fragments below the tracked size', () => {
    const r = reconcileClusters({
      ...base,
      detected: new Map([
        [0, ids('a', 10)],
        [1, ids('b', MIN_TRACKED_SIZE - 1)],
      ]),
      stored: [],
      mintKey: mint(),
    });
    expect(r.clusters).toHaveLength(1);
    expect(r.keyByIndex.has(1)).toBe(false);
  });

  it('does not match two clusters that merely share a few members', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 20)]]),
      stored: [],
      mintKey: mint(),
    });
    // 2 of 20 in common — a coincidence, not the same cluster.
    const second = reconcileClusters({
      ...base,
      detected: new Map([[0, [...ids('a', 2), ...ids('z', 18)]]]),
      stored: first.clusters,
      mintKey: mint(),
    });
    expect(second.changes.created).toHaveLength(1);
    expect(second.clusters.find((c) => c.key === 'cl_1')!.live).toBe(false);
  });

  it('is order-independent — the best overlap wins regardless of input order', () => {
    const existing = [
      stored({ key: 'cl_1', members: ids('a', 10), colourIndex: 0 }),
      stored({ key: 'cl_2', members: [...ids('a', 5), ...ids('b', 5)], colourIndex: 1 }),
    ];
    const forwards = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: existing,
      mintKey: mint(),
    });
    const backwards = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: [...existing].reverse(),
      mintKey: mint(),
    });
    expect(forwards.keyByIndex.get(0)).toBe('cl_1');
    expect(backwards.keyByIndex.get(0)).toBe('cl_1');
  });

  it('advances lastSeenAt on a match and leaves firstSeenAt alone', () => {
    const first = reconcileClusters({
      ...base,
      detected: new Map([[0, ids('a', 10)]]),
      stored: [],
      mintKey: mint(),
    });
    const later = '2026-08-15T00:00:00.000Z';
    const second = reconcileClusters({
      ...base,
      now: later,
      detected: new Map([[0, ids('a', 10)]]),
      stored: first.clusters,
      mintKey: mint(),
    });
    expect(second.clusters[0].firstSeenAt).toBe(NOW);
    expect(second.clusters[0].lastSeenAt).toBe(later);
  });
});
