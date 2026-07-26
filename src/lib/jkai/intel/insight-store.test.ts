import { describe, it, expect } from 'vitest';
import {
  clampInsightLimit,
  clampScore,
  clampSnoozeDays,
  dedupeKeyFor,
  isInsightStatus,
  MAX_KEY_ENTITIES,
  MAX_SNOOZE_DAYS,
  normalizeKeyEntityIds,
  SCORE_BUCKETS,
  scoreBucket,
  toInsightRow,
  type StorableInsight,
} from './insight-store';

function insight(over: Partial<StorableInsight> = {}): StorableInsight {
  return {
    kind: 'broker',
    title: 'Acme connects three parts of your graph',
    detail: 'Acme is the link between three otherwise separate clusters.',
    score: 0.5,
    entityIds: ['e1'],
    action: 'research',
    actionLabel: 'Deep dive on Acme',
    actionPayload: 'Acme — full profile',
    ...over,
  };
}

describe('clampScore', () => {
  it('passes through anything already in range', () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(0.37)).toBe(0.37);
    expect(clampScore(1)).toBe(1);
  });

  it('clamps out-of-range scores rather than producing out-of-range buckets', () => {
    expect(clampScore(2.5)).toBe(1);
    expect(clampScore(-4)).toBe(0);
  });

  it('treats unparseable input as zero so a bad detector cannot poison a key', () => {
    expect(clampScore(NaN)).toBe(0);
    expect(clampScore(undefined)).toBe(0);
    expect(clampScore('not a number')).toBe(0);
    expect(clampScore(Infinity)).toBe(0);
  });
});

describe('scoreBucket', () => {
  it('splits 0..1 into evenly sized bands', () => {
    expect(scoreBucket(0)).toBe(0);
    expect(scoreBucket(0.19)).toBe(0);
    expect(scoreBucket(0.2)).toBe(1);
    expect(scoreBucket(0.55)).toBe(2);
    expect(scoreBucket(0.79)).toBe(3);
    expect(scoreBucket(0.8)).toBe(4);
  });

  it('keeps a perfect score inside the top band rather than off the end', () => {
    expect(scoreBucket(1)).toBe(SCORE_BUCKETS - 1);
    expect(scoreBucket(9)).toBe(SCORE_BUCKETS - 1);
  });
});

describe('normalizeKeyEntityIds', () => {
  it('is order-independent', () => {
    expect(normalizeKeyEntityIds(['b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
    expect(normalizeKeyEntityIds(['c', 'b', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('drops duplicates and blanks', () => {
    expect(normalizeKeyEntityIds(['a', 'a', '', '  ', 'b'])).toEqual(['a', 'b']);
  });

  it('trims, so whitespace from a payload cannot fork a key', () => {
    expect(normalizeKeyEntityIds([' a ', 'a'])).toEqual(['a']);
  });

  it('caps the list so a population finding keeps a stable anchor', () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'];
    expect(normalizeKeyEntityIds(ids)).toHaveLength(MAX_KEY_ENTITIES);
    expect(normalizeKeyEntityIds(ids)).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  });

  it('tolerates a missing or non-array list', () => {
    expect(normalizeKeyEntityIds(null)).toEqual([]);
    expect(normalizeKeyEntityIds(undefined)).toEqual([]);
    expect(normalizeKeyEntityIds('nope' as unknown as string[])).toEqual([]);
  });
});

describe('dedupeKeyFor — stability', () => {
  it('is identical across runs for an identical finding', () => {
    expect(dedupeKeyFor(insight())).toBe(dedupeKeyFor(insight()));
  });

  it('ignores the order the detector emitted entity ids in', () => {
    const a = dedupeKeyFor(insight({ entityIds: ['x', 'y', 'z'] }));
    const b = dedupeKeyFor(insight({ entityIds: ['z', 'x', 'y'] }));
    expect(a).toBe(b);
  });

  it('survives score jitter inside a band — the point of bucketing', () => {
    const a = dedupeKeyFor(insight({ score: 0.41 }));
    const b = dedupeKeyFor(insight({ score: 0.58 }));
    expect(a).toBe(b);
  });

  it('is case- and whitespace-insensitive on kind', () => {
    expect(dedupeKeyFor(insight({ kind: ' Broker ' }))).toBe(dedupeKeyFor(insight({ kind: 'broker' })));
  });

  it('does not depend on title, detail or the proposed action', () => {
    const a = dedupeKeyFor(insight());
    const b = dedupeKeyFor(
      insight({ title: 'rephrased', detail: 'rewritten', action: 'ask', actionLabel: 'Ask jkai' }),
    );
    expect(a).toBe(b);
  });
});

describe('dedupeKeyFor — sensitivity', () => {
  it('changes when the score crosses a band', () => {
    const a = dedupeKeyFor(insight({ score: 0.39 }));
    const b = dedupeKeyFor(insight({ score: 0.41 }));
    expect(a).not.toBe(b);
  });

  it('changes when the finding is about a different entity', () => {
    expect(dedupeKeyFor(insight({ entityIds: ['e1'] }))).not.toBe(
      dedupeKeyFor(insight({ entityIds: ['e2'] })),
    );
  });

  it('changes when an entity joins a small finding', () => {
    expect(dedupeKeyFor(insight({ entityIds: ['e1'] }))).not.toBe(
      dedupeKeyFor(insight({ entityIds: ['e1', 'e2'] })),
    );
  });

  it('separates different kinds about the same entity', () => {
    expect(dedupeKeyFor(insight({ kind: 'broker' }))).not.toBe(
      dedupeKeyFor(insight({ kind: 'stale_hub' })),
    );
  });
});

describe('dedupeKeyFor — population findings', () => {
  it('ignores the entity sample for kinds whose list is a rolling sample', () => {
    const a = dedupeKeyFor({ kind: 'orphan', score: 0.4, entityIds: ['a', 'b', 'c'] });
    const b = dedupeKeyFor({ kind: 'orphan', score: 0.4, entityIds: ['d', 'e'] });
    expect(a).toBe(b);
  });

  it('still re-raises a sample finding when it gets materially worse', () => {
    const mild = dedupeKeyFor({ kind: 'orphan', score: 0.3, entityIds: ['a'] });
    const bad = dedupeKeyFor({ kind: 'orphan', score: 0.7, entityIds: ['a'] });
    expect(mild).not.toBe(bad);
  });

  it('holds the key steady when a large population gains a member below the anchor cap', () => {
    const before = dedupeKeyFor(
      insight({ kind: 'isolated_cluster', entityIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] }),
    );
    const after = dedupeKeyFor(
      insight({
        kind: 'isolated_cluster',
        entityIds: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'z9'],
      }),
    );
    expect(before).toBe(after);
  });

  it('keeps distinct islands distinct', () => {
    const one = dedupeKeyFor(insight({ kind: 'isolated_cluster', entityIds: ['a1', 'a2', 'a3'] }));
    const two = dedupeKeyFor(insight({ kind: 'isolated_cluster', entityIds: ['b1', 'b2', 'b3'] }));
    expect(one).not.toBe(two);
  });

  it('gives graph-wide findings with no entities a key of their own', () => {
    const key = dedupeKeyFor({ kind: 'dominant_cluster', score: 0.55, entityIds: [] });
    expect(key).toBe('dominant_cluster|*|b2');
  });
});

describe('toInsightRow', () => {
  it('maps a detector finding onto the stored columns', () => {
    const row = toInsightRow(insight(), 'broker|e1|b2', 'run-1');
    expect(row.kind).toBe('broker');
    expect(row.explanation).toBe(insight().detail);
    expect(row.dedupeKey).toBe('broker|e1|b2');
    expect(row.runId).toBe('run-1');
    expect(row.entityIds).toEqual(['e1']);
    expect(row.components).toEqual({});
    expect(row.narrative).toBeNull();
  });

  it('folds the action triple into one proposed action', () => {
    expect(toInsightRow(insight(), 'k').proposedActions).toEqual([
      { kind: 'research', label: 'Deep dive on Acme', payload: 'Acme — full profile' },
    ]);
  });

  it('proposes nothing when the detector offered no action', () => {
    const row = toInsightRow(insight({ action: undefined, actionLabel: undefined }), 'k');
    expect(row.proposedActions).toEqual([]);
  });

  it('clamps the stored score', () => {
    expect(toInsightRow(insight({ score: 4 }), 'k').score).toBe(1);
  });
});

describe('clampSnoozeDays', () => {
  it('rounds to whole days', () => {
    expect(clampSnoozeDays(7.4)).toBe(7);
  });

  it('never snoozes for less than a day, whatever was asked for', () => {
    expect(clampSnoozeDays(0)).toBe(1);
    expect(clampSnoozeDays(-5)).toBe(1);
    expect(clampSnoozeDays('nonsense')).toBe(1);
  });

  it('caps at a year so a snooze is never a silent permanent dismissal', () => {
    expect(clampSnoozeDays(10_000)).toBe(MAX_SNOOZE_DAYS);
  });
});

describe('clampInsightLimit', () => {
  it('falls back to the default for junk', () => {
    expect(clampInsightLimit('abc')).toBe(60);
    expect(clampInsightLimit(0)).toBe(60);
  });

  it('caps an unbounded read', () => {
    expect(clampInsightLimit(99_999)).toBe(500);
  });
});

describe('isInsightStatus', () => {
  it('accepts the known statuses only', () => {
    expect(isInsightStatus('new')).toBe(true);
    expect(isInsightStatus('snoozed')).toBe(true);
    expect(isInsightStatus('deleted')).toBe(false);
    expect(isInsightStatus(null)).toBe(false);
  });
});
