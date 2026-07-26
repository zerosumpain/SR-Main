import { describe, it, expect } from 'vitest';
import {
  ALARM_KINDS,
  changeToInsight,
  communityAnchors,
  diffWatched,
  percentile,
  WATCH_INSIGHT_KINDS,
  type WatchChange,
  type WatchChangeKind,
  type WatchedSnapshotEntry,
  type WatchlistSnapshot,
} from './watchlist';
import { dedupeKeyFor } from './insight-store';

function entry(over: Partial<WatchedSnapshotEntry> = {}): WatchedSnapshotEntry {
  return {
    id: 'e1',
    name: 'Acme Corp',
    degree: 6,
    communityKey: 'c-anchor',
    communitySize: 12,
    brokerage: 0.01,
    broker: false,
    confidence: 0.7,
    neighbours: [
      { id: 'n1', name: 'Jane Doe', importance: 0.9 },
      { id: 'n2', name: 'Beta Ltd', importance: 0.2 },
    ],
    ...over,
  };
}

function snap(entities: WatchedSnapshotEntry[], takenAt = 1_000): WatchlistSnapshot {
  return { takenAt, entities };
}

function kinds(changes: WatchChange[]): WatchChangeKind[] {
  return changes.map((c) => c.kind);
}

function only(changes: WatchChange[], kind: WatchChangeKind): WatchChange {
  const hit = changes.find((c) => c.kind === kind);
  if (!hit) throw new Error(`expected a ${kind} change, got ${kinds(changes).join(', ') || 'none'}`);
  return hit;
}

describe('percentile', () => {
  it('is zero for an empty distribution rather than NaN', () => {
    expect(percentile([], 0.9)).toBe(0);
  });

  it('picks a value from the ascending array', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0)).toBe(1);
  });

  it('never runs off the end', () => {
    expect(percentile([1, 2, 3], 1)).toBe(3);
    expect(percentile([1, 2, 3], 5)).toBe(3);
  });
});

describe('communityAnchors', () => {
  it('anchors a community on its lexicographically smallest member', () => {
    const anchors = communityAnchors(new Map([[0, ['z', 'a', 'm']]]));
    expect(anchors.get(0)).toEqual({ key: 'a', size: 3 });
  });

  it('gives the same anchor when Louvain relabels the same partition', () => {
    const run1 = communityAnchors(
      new Map([
        [0, ['a', 'b']],
        [1, ['x', 'y']],
      ]),
    );
    const run2 = communityAnchors(
      new Map([
        [0, ['y', 'x']],
        [1, ['b', 'a']],
      ]),
    );
    expect(run1.get(0)!.key).toBe(run2.get(1)!.key);
    expect(run1.get(1)!.key).toBe(run2.get(0)!.key);
  });

  it('skips empty communities', () => {
    expect(communityAnchors(new Map([[0, []]])).size).toBe(0);
  });
});

describe('diffWatched — silence', () => {
  it('says nothing when nothing changed', () => {
    expect(diffWatched(snap([entry()]), snap([entry()], 2_000))).toEqual([]);
  });

  it('says nothing with no previous snapshot — that is a baseline, not news', () => {
    expect(diffWatched(null, snap([entry()]))).toEqual([]);
    expect(diffWatched(undefined, snap([entry()]))).toEqual([]);
  });

  it('ignores a degree wobble too small to be structural', () => {
    const changes = diffWatched(snap([entry({ degree: 6 })]), snap([entry({ degree: 8 })]));
    expect(changes).toEqual([]);
  });

  it('ignores a large relative move that is tiny in absolute terms', () => {
    // 1 → 2 is a 100% jump and means nothing.
    const changes = diffWatched(snap([entry({ degree: 1 })]), snap([entry({ degree: 2 })]));
    expect(changes).toEqual([]);
  });

  it('ignores a confidence nudge below the drop threshold', () => {
    const changes = diffWatched(
      snap([entry({ confidence: 0.7 })]),
      snap([entry({ confidence: 0.61 })]),
    );
    expect(changes).toEqual([]);
  });

  it('does not alarm on a confidence RISE', () => {
    const changes = diffWatched(
      snap([entry({ confidence: 0.3 })]),
      snap([entry({ confidence: 0.9 })]),
    );
    expect(changes).toEqual([]);
  });

  it('does not report a cluster move when either side has no anchor', () => {
    const changes = diffWatched(
      snap([entry({ communityKey: '' })]),
      snap([entry({ communityKey: 'c-other' })]),
    );
    expect(kinds(changes)).not.toContain('community_move');
  });
});

describe('diffWatched — degree', () => {
  it('reports a jump that is both large and relatively large', () => {
    const changes = diffWatched(snap([entry({ degree: 4 })]), snap([entry({ degree: 11 })]));
    const jump = only(changes, 'degree_jump');
    expect(jump.sentence).toContain('4 connections to 11');
    expect(jump.sentence).toContain('175%');
    expect(jump.components).toEqual({ previousDegree: 4, currentDegree: 11, gained: 7 });
    expect(jump.severity).toBeGreaterThan(0.5);
  });

  it('phrases a jump off zero without a meaningless percentage', () => {
    const jump = only(diffWatched(snap([entry({ degree: 0 })]), snap([entry({ degree: 4 })])), 'degree_jump');
    expect(jump.sentence).toContain('no connections at all to 4');
    expect(jump.sentence).not.toContain('%');
  });

  it('reports a collapse', () => {
    const changes = diffWatched(snap([entry({ degree: 12 })]), snap([entry({ degree: 3 })]));
    const collapse = only(changes, 'degree_collapse');
    expect(collapse.sentence).toContain('dropped from 12 connections to 3');
    expect(collapse.components.lost).toBe(9);
  });

  it('phrases a total collapse as such', () => {
    const collapse = only(
      diffWatched(snap([entry({ degree: 5 })]), snap([entry({ degree: 0 })])),
      'degree_collapse',
    );
    expect(collapse.sentence).toContain('lost all 5 of its connections');
  });

  it('rates a collapse above a comparable jump — losing what you knew is worse', () => {
    const jump = only(diffWatched(snap([entry({ degree: 4 })]), snap([entry({ degree: 8 })])), 'degree_jump');
    const collapse = only(
      diffWatched(snap([entry({ degree: 8 })]), snap([entry({ degree: 4 })])),
      'degree_collapse',
    );
    expect(collapse.severity).toBeGreaterThan(jump.severity);
  });
});

describe('diffWatched — cluster, brokerage, confidence', () => {
  it('reports a cluster move', () => {
    const move = only(
      diffWatched(
        snap([entry({ communityKey: 'c-a', communitySize: 12 })]),
        snap([entry({ communityKey: 'c-b', communitySize: 30 })]),
      ),
      'community_move',
    );
    expect(move.sentence).toContain('moved cluster');
    expect(move.sentence).toContain('30 entities');
  });

  it('reports becoming a broker, and rates it highest of the structural moves', () => {
    const became = only(
      diffWatched(snap([entry({ broker: false })]), snap([entry({ broker: true })])),
      'became_broker',
    );
    expect(became.sentence).toContain('single point of failure');
    expect(became.severity).toBe(0.75);
  });

  it('reports ceasing to be a broker, more quietly', () => {
    const ceased = only(
      diffWatched(snap([entry({ broker: true })]), snap([entry({ broker: false })])),
      'ceased_broker',
    );
    expect(ceased.severity).toBeLessThan(0.75);
  });

  it('reports a confidence drop with both numbers in the sentence', () => {
    const drop = only(
      diffWatched(snap([entry({ confidence: 0.82 })]), snap([entry({ confidence: 0.41 })])),
      'confidence_drop',
    );
    expect(drop.sentence).toContain('0.82');
    expect(drop.sentence).toContain('0.41');
    expect(drop.components.drop).toBeCloseTo(0.41, 2);
  });

  it('cannot compare confidence when either side was never scored', () => {
    expect(
      diffWatched(snap([entry({ confidence: null })]), snap([entry({ confidence: 0.1 })])),
    ).toEqual([]);
    expect(
      diffWatched(snap([entry({ confidence: 0.9 })]), snap([entry({ confidence: null })])),
    ).toEqual([]);
  });
});

describe('diffWatched — new neighbours', () => {
  it('reports a high-importance arrival and names it', () => {
    const changes = diffWatched(
      snap([entry({ neighbours: [{ id: 'n2', name: 'Beta Ltd', importance: 0.2 }] })]),
      snap([
        entry({
          neighbours: [
            { id: 'n2', name: 'Beta Ltd', importance: 0.2 },
            { id: 'n9', name: 'Whitehall Unit', importance: 0.95 },
          ],
        }),
      ]),
    );
    const arrival = only(changes, 'new_important_neighbour');
    expect(arrival.sentence).toContain('Whitehall Unit');
    expect(arrival.relatedIds).toEqual(['n9']);
    expect(arrival.relatedNames).toEqual(['Whitehall Unit']);
  });

  it('ignores an arrival that is not important', () => {
    const changes = diffWatched(
      snap([entry({ neighbours: [] })]),
      snap([entry({ neighbours: [{ id: 'n7', name: 'Some Doc', importance: 0.05 }] })]),
    );
    expect(kinds(changes)).not.toContain('new_important_neighbour');
  });

  it('ignores a neighbour that was already there', () => {
    const before = [{ id: 'n1', name: 'Jane Doe', importance: 0.9 }];
    const changes = diffWatched(
      snap([entry({ neighbours: before })]),
      snap([entry({ neighbours: [{ id: 'n1', name: 'Jane Doe', importance: 0.99 }] })]),
    );
    expect(kinds(changes)).not.toContain('new_important_neighbour');
  });

  it('folds several arrivals into one change, loudest named first', () => {
    const changes = diffWatched(
      snap([entry({ neighbours: [] })]),
      snap([
        entry({
          neighbours: [
            { id: 'a', name: 'Alpha', importance: 0.6 },
            { id: 'b', name: 'Bravo', importance: 0.95 },
            { id: 'c', name: 'Charlie', importance: 0.7 },
          ],
        }),
      ]),
    );
    const arrival = only(changes, 'new_important_neighbour');
    expect(arrival.relatedNames).toEqual(['Bravo', 'Charlie', 'Alpha']);
    expect(arrival.sentence).toContain('Bravo, Charlie and 1 others');
    expect(arrival.components.arrivals).toBe(3);
  });
});

describe('diffWatched — arrivals and departures', () => {
  it('records an entity newly on the watchlist as a baseline, not an alarm', () => {
    const changes = diffWatched(snap([]), snap([entry({ degree: 6 })]));
    const appeared = only(changes, 'appeared');
    expect(appeared.sentence).toContain('now being watched');
    expect(appeared.sentence).toContain('6 connections');
    expect(ALARM_KINDS.has('appeared')).toBe(false);
  });

  it('does not diff an appearing entity against nothing', () => {
    const changes = diffWatched(snap([]), snap([entry({ degree: 40, broker: true })]));
    expect(kinds(changes)).toEqual(['appeared']);
  });

  it('reports a departure using the last thing it knew', () => {
    const changes = diffWatched(snap([entry({ degree: 9 })]), snap([]));
    const gone = only(changes, 'disappeared');
    expect(gone.entityName).toBe('Acme Corp');
    expect(gone.sentence).toContain('9 connections');
    expect(gone.components).toEqual({ previousDegree: 9 });
  });

  it('handles both directions at once without cross-talk', () => {
    const changes = diffWatched(
      snap([entry({ id: 'old', name: 'Old Thing' })]),
      snap([entry({ id: 'new', name: 'New Thing' })]),
    );
    expect(changes.map((c) => [c.kind, c.entityId])).toEqual(
      expect.arrayContaining([
        ['disappeared', 'old'],
        ['appeared', 'new'],
      ]),
    );
    expect(changes).toHaveLength(2);
  });
});

describe('diffWatched — several changes at once', () => {
  it('reports every independent change on one entity', () => {
    const before = entry({ degree: 12, communityKey: 'c-a', broker: false, confidence: 0.9 });
    const after = entry({
      degree: 3,
      communityKey: 'c-b',
      broker: true,
      confidence: 0.5,
      neighbours: [{ id: 'n9', name: 'Whitehall Unit', importance: 0.95 }],
    });
    const changes = diffWatched(snap([before]), snap([after]));
    expect(new Set(kinds(changes))).toEqual(
      new Set([
        'degree_collapse',
        'community_move',
        'became_broker',
        'confidence_drop',
        'new_important_neighbour',
      ]),
    );
  });

  it('orders loudest first and is stable for equal severities', () => {
    const changes = diffWatched(
      snap([entry({ id: 'b', name: 'Bravo', broker: true }), entry({ id: 'a', name: 'Alpha', broker: true })]),
      snap([entry({ id: 'b', name: 'Bravo', broker: false }), entry({ id: 'a', name: 'Alpha', broker: false })]),
    );
    expect(changes.map((c) => c.entityName)).toEqual(['Alpha', 'Bravo']);
    const severities = changes.map((c) => c.severity);
    expect([...severities].sort((x, y) => y - x)).toEqual(severities);
  });
});

describe('changeToInsight', () => {
  const arrival = only(
    diffWatched(
      snap([entry({ neighbours: [] })]),
      snap([entry({ neighbours: [{ id: 'n9', name: 'Whitehall Unit', importance: 0.95 }] })]),
    ),
    'new_important_neighbour',
  );

  it('gives each change kind its own insight kind', () => {
    expect(changeToInsight(arrival).kind).toBe('watch_new_important_neighbour');
    expect(WATCH_INSIGHT_KINDS).toContain('watch_new_important_neighbour');
  });

  it('carries the sentence as the explanation and the severity as the score', () => {
    const insight = changeToInsight(arrival);
    expect(insight.detail).toBe(arrival.sentence);
    expect(insight.score).toBe(arrival.severity);
    expect(insight.components).toBe(arrival.components);
  });

  it('includes the related entity so the finding is about the pair', () => {
    expect(changeToInsight(arrival).entityIds).toEqual(['e1', 'n9']);
  });

  it('proposes an action that names the entities involved', () => {
    const insight = changeToInsight(arrival);
    expect(insight.actionPayload).toContain('Acme Corp');
    expect(insight.actionPayload).toContain('Whitehall Unit');
  });

  it('routes a weakening finding to review rather than more research', () => {
    const drop = only(
      diffWatched(snap([entry({ confidence: 0.9 })]), snap([entry({ confidence: 0.4 })])),
      'confidence_drop',
    );
    expect(changeToInsight(drop).action).toBe('review');
    expect(changeToInsight(drop).actionPayload).toBe('/jkai/intel/entities/e1');
  });

  it('keeps two different alarms on one entity on separate dedupe keys', () => {
    const before = entry({ degree: 12, broker: false });
    const after = entry({ degree: 3, broker: true });
    const changes = diffWatched(snap([before]), snap([after]));
    const keys = changes.map((c) => dedupeKeyFor(changeToInsight(c)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives the same alarm the same key across two runs', () => {
    const run = () =>
      dedupeKeyFor(
        changeToInsight(
          only(diffWatched(snap([entry({ degree: 4 })]), snap([entry({ degree: 11 })])), 'degree_jump'),
        ),
      );
    expect(run()).toBe(run());
  });
});
