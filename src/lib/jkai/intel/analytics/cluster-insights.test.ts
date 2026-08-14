import { describe, it, expect } from 'vitest';
import {
  generateClusterInsights,
  EMERGING_AGE_DAYS,
  EMERGING_MIN_SIZE,
  DORMANT_DAYS,
  DORMANT_MIN_SIZE,
} from './cluster-insights';
import type { StoredCluster, ReconcileChanges } from './cluster-identity';

const NOW = Date.parse('2026-08-14T00:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

function cluster(over: Partial<StoredCluster> & Pick<StoredCluster, 'key'>): StoredCluster {
  const size = over.size ?? over.members?.length ?? 20;
  return {
    name: null,
    autoLabel: `auto-${over.key}`,
    colourIndex: 0,
    members: Array.from({ length: size }, (_, i) => `${over.key}-e${i}`),
    size,
    firstSeenAt: ago(200),
    lastSeenAt: ago(0),
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

const noChanges: ReconcileChanges = {
  created: [],
  matched: [],
  retired: [],
  merged: [],
  split: [],
};

const run = (
  clusters: StoredCluster[],
  changes: Partial<ReconcileChanges> = {},
  freshest: Record<string, number> = {},
) =>
  generateClusterInsights({
    clusters,
    changes: { ...noChanges, ...changes },
    freshestEvidence: new Map(Object.entries(freshest)),
    now: NOW,
  });

describe('cluster_merging', () => {
  it('reports two neighbourhoods becoming one', () => {
    const found = run(
      [
        cluster({ key: 'a', mergedFrom: ['b'], name: 'DfE work' }),
        cluster({ key: 'b', live: false, name: 'Data Spine' }),
      ],
      { merged: ['a'] },
    );
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe('cluster_merging');
    expect(found[0].title).toContain('DfE work');
    expect(found[0].title).toContain('Data Spine');
  });

  it('scores a merge of two substantial clusters above one absorbing a fragment', () => {
    const big = run(
      [cluster({ key: 'a', mergedFrom: ['b'] }), cluster({ key: 'b', size: 40, live: false })],
      { merged: ['a'] },
    );
    const small = run(
      [cluster({ key: 'a', mergedFrom: ['b'] }), cluster({ key: 'b', size: 5, live: false })],
      { merged: ['a'] },
    );
    expect(big[0].score).toBeGreaterThan(small[0].score);
  });

  it('says nothing when the absorbed cluster is no longer on file', () => {
    expect(run([cluster({ key: 'a', mergedFrom: ['gone'] })], { merged: ['a'] })).toEqual([]);
  });

  it('carries entity ids so the finding can open the subgraph', () => {
    const found = run(
      [cluster({ key: 'a', mergedFrom: ['b'] }), cluster({ key: 'b', live: false })],
      { merged: ['a'] },
    );
    expect(found[0].entityIds.length).toBeGreaterThan(0);
  });
});

describe('cluster_emerging', () => {
  /**
   * A long-established cluster, present in every emerging test so the roster
   * has a history to judge newness against — see `rosterHasHistory`.
   */
  const established = cluster({ key: 'old', firstSeenAt: ago(200), size: 30 });

  it('reports a substantial cluster that formed recently', () => {
    const found = run([established, cluster({ key: 'a', firstSeenAt: ago(5), size: 30 })]);
    expect(found.map((f) => f.kind)).toContain('cluster_emerging');
    expect(found[0].detail).toContain('5 days');
  });

  it('ignores one that has been there all along', () => {
    const found = run([established, cluster({ key: 'a', firstSeenAt: ago(EMERGING_AGE_DAYS + 5), size: 30 })]);
    expect(found).toEqual([]);
  });

  it('ignores one too small for its appearance to mean anything', () => {
    const found = run([
      established,
      cluster({ key: 'a', firstSeenAt: ago(3), size: EMERGING_MIN_SIZE - 1 }),
    ]);
    expect(found).toEqual([]);
  });

  it('does not call a split-off cluster new', () => {
    // The same area described more finely is not a new area of interest, and
    // saying "new" about it is technically true and useless.
    const found = run([
      established,
      cluster({ key: 'a', firstSeenAt: ago(2), size: 30, splitFrom: 'parent' }),
    ]);
    expect(found).toEqual([]);
  });

  it('says nothing at all on the run that first builds the roster', () => {
    // Every cluster is minted at once, so every one looks new. Reporting that
    // would fire a hundred findings on the day the feature ships, about
    // clusters that have been there for months.
    const found = run([
      cluster({ key: 'a', firstSeenAt: ago(0), size: 40 }),
      cluster({ key: 'b', firstSeenAt: ago(0), size: 60 }),
      cluster({ key: 'c', firstSeenAt: ago(0), size: 30 }),
    ]);
    expect(found.filter((f) => f.kind === 'cluster_emerging')).toEqual([]);
  });

  it('prefers the name the user gave it', () => {
    const found = run([established, cluster({ key: 'a', firstSeenAt: ago(2), size: 30, name: 'Broads pilot' })]);
    expect(found[0].title).toContain('Broads pilot');
  });
});

describe('cluster_dormant', () => {
  it('reports a substantial cluster with no recent evidence', () => {
    const found = run([cluster({ key: 'a', size: 30 })], {}, { a: NOW - (DORMANT_DAYS + 20) * DAY });
    expect(found.map((f) => f.kind)).toContain('cluster_dormant');
  });

  it('stays quiet while evidence is still arriving', () => {
    const found = run([cluster({ key: 'a', size: 30 })], {}, { a: NOW - 3 * DAY });
    expect(found).toEqual([]);
  });

  it('ignores a cluster too small to be worth reporting', () => {
    const found = run(
      [cluster({ key: 'a', size: DORMANT_MIN_SIZE - 1 })],
      {},
      { a: NOW - 200 * DAY },
    );
    expect(found).toEqual([]);
  });

  it('says nothing about a cluster whose evidence has no date', () => {
    expect(run([cluster({ key: 'a', size: 30 })])).toEqual([]);
  });

  it('scores below the other kinds — dormancy is context, not an alarm', () => {
    const found = run([cluster({ key: 'a', size: 30 })], {}, { a: NOW - 400 * DAY });
    expect(found[0].score).toBeLessThanOrEqual(0.55);
  });
});

describe('generateClusterInsights', () => {
  it('returns findings strongest first', () => {
    const found = run(
      [
        cluster({ key: 'a', firstSeenAt: ago(2), size: 60 }),
        cluster({ key: 'd', size: 30 }),
      ],
      {},
      { d: NOW - 200 * DAY },
    );
    expect(found.length).toBeGreaterThan(1);
    expect(found[0].score).toBeGreaterThanOrEqual(found[1].score);
  });

  it('ignores retired clusters entirely', () => {
    const found = run(
      [cluster({ key: 'a', firstSeenAt: ago(2), size: 40, live: false })],
      {},
      { a: NOW - 300 * DAY },
    );
    expect(found).toEqual([]);
  });

  it('gives every finding a distinct id, so two can be dismissed separately', () => {
    const found = run([
      cluster({ key: 'a', firstSeenAt: ago(2), size: 30 }),
      cluster({ key: 'b', firstSeenAt: ago(3), size: 30 }),
    ]);
    expect(new Set(found.map((f) => f.id)).size).toBe(found.length);
  });
});
