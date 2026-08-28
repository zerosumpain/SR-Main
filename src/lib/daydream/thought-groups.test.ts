import { describe, it, expect } from 'vitest';
import {
  FAMILIES,
  MIN_RATED_FOR_RATE,
  familyOf,
  groupByFamily,
  groupByLikelihood,
  groupStats,
  kindLabel,
  likelihoodBand,
  type GroupableThought,
} from './thought-groups';

function t(
  kind: string,
  score: number,
  extra: Partial<GroupableThought> = {},
): GroupableThought {
  return {
    kind,
    score,
    status: 'new',
    feedback: null,
    createdAt: '2026-08-28T10:00:00.000Z',
    ...extra,
  };
}

describe('familyOf', () => {
  it('files both spellings of the place detector together', () => {
    // Renamed in August; the old rows stayed in the ledger.
    expect(familyOf('unknown_place')).toBe(FAMILIES.places);
    expect(familyOf('unknown_frequent_place')).toBe(FAMILIES.places);
  });

  it('files an open kind space by prefix, so new suffixes never fall through', () => {
    expect(familyOf('musing_health')).toBe(FAMILIES.musings);
    expect(familyOf('musing_a_theme_invented_next_year')).toBe(FAMILIES.musings);
    expect(familyOf('mail_security')).toBe(FAMILIES.mail);
    expect(familyOf('mail_something_new')).toBe(FAMILIES.mail);
    expect(familyOf('intel_broker')).toBe(FAMILIES.graph);
  });

  it('puts the detector kinds in patterns', () => {
    for (const k of ['near_offer', 'free_window', 'pattern_break', 'context_meets_health']) {
      expect(familyOf(k)).toBe(FAMILIES.patterns);
    }
  });

  it('never returns undefined for an unknown kind', () => {
    expect(familyOf('something_nobody_has_written_yet')).toBeTruthy();
  });
});

describe('kindLabel', () => {
  it('strips the family prefix and the underscores', () => {
    expect(kindLabel('musing_health')).toBe('health');
    expect(kindLabel('mail_money_admin')).toBe('money admin');
    expect(kindLabel('intel_emerging_hub')).toBe('emerging hub');
    expect(kindLabel('pattern_break')).toBe('pattern break');
  });
});

describe('likelihoodBand', () => {
  // Bands are relative to the threshold, which MOVES: it opens at 0.75 and
  // falls towards 0.45 as feedback accumulates. Fixed cut-offs would relabel
  // every historical thought each time it shifted.
  it('calls the same score different things at different thresholds', () => {
    expect(likelihoodBand(0.7, 0.75).id).toBe('held');
    expect(likelihoodBand(0.7, 0.45).id).toBe('strong');
  });

  it('separates just-over from well-clear', () => {
    expect(likelihoodBand(0.76, 0.75).id).toBe('marginal');
    expect(likelihoodBand(0.82, 0.75).id).toBe('likely');
    expect(likelihoodBand(0.95, 0.75).id).toBe('strong');
  });

  it('explains itself in numbers a reader can check', () => {
    expect(likelihoodBand(0.7, 0.75).meaning).toContain('0.70');
    expect(likelihoodBand(0.7, 0.75).meaning).toContain('0.75');
  });
});

describe('groupStats', () => {
  it('withholds a useful rate until there are enough votes to mean anything', () => {
    const few = [
      t('musing_health', 0.8, { feedback: 'useful' }),
      t('musing_health', 0.8, { feedback: 'not_useful' }),
    ];
    expect(groupStats(few).rated).toBe(2);
    expect(groupStats(few).usefulRate).toBeNull();
  });

  it('reports a rate once the denominator is respectable', () => {
    const many = Array.from({ length: MIN_RATED_FOR_RATE }, (_, i) =>
      t('musing_health', 0.8, { feedback: i === 0 ? 'not_useful' : 'useful' }),
    );
    const s = groupStats(many);
    expect(s.rated).toBe(MIN_RATED_FOR_RATE);
    expect(s.usefulRate).toBeCloseTo((MIN_RATED_FOR_RATE - 1) / MIN_RATED_FOR_RATE);
  });

  it('counts actioned thoughts as delivered — acting on one means it arrived', () => {
    const s = groupStats([
      t('unknown_place', 0.9, { status: 'delivered' }),
      t('unknown_place', 0.9, { status: 'actioned' }),
      t('unknown_place', 0.9, { status: 'suppressed' }),
    ]);
    expect(s.delivered).toBe(2);
    expect(s.held).toBe(1);
  });

  it('has an honest answer for an empty group', () => {
    const s = groupStats([]);
    expect(s).toMatchObject({ count: 0, usefulRate: null, latest: null });
  });

  it('reports the newest member, not the first in the array', () => {
    const s = groupStats([
      t('a', 0.5, { createdAt: '2026-08-01T00:00:00.000Z' }),
      t('a', 0.5, { createdAt: '2026-08-28T00:00:00.000Z' }),
      t('a', 0.5, { createdAt: '2026-08-14T00:00:00.000Z' }),
    ]);
    expect(s.latest).toBe('2026-08-28T00:00:00.000Z');
  });
});

describe('groupByFamily', () => {
  const items = [
    t('unknown_place', 0.9),
    t('unknown_frequent_place', 0.8),
    t('musing_health', 0.7, { createdAt: '2026-08-27T10:00:00.000Z' }),
    t('musing_money', 0.6, { createdAt: '2026-08-28T11:00:00.000Z' }),
    t('mail_security', 0.85),
  ];

  it('puts both place spellings in one group', () => {
    const places = groupByFamily(items).find((g) => g.key === 'places');
    expect(places?.items).toHaveLength(2);
  });

  it('orders groups by size', () => {
    const keys = groupByFamily(items).map((g) => g.key);
    expect(keys.indexOf('places')).toBeLessThan(keys.indexOf('mail'));
  });

  it('orders items inside a group newest first', () => {
    const musings = groupByFamily(items).find((g) => g.key === 'musings');
    expect(musings?.items[0].createdAt).toBe('2026-08-28T11:00:00.000Z');
  });

  it('gives every group a blurb explaining what produced it', () => {
    for (const g of groupByFamily(items)) expect(g.blurb).toBeTruthy();
  });

  it('loses nothing', () => {
    const total = groupByFamily(items).reduce((a, g) => a + g.items.length, 0);
    expect(total).toBe(items.length);
  });
});

describe('groupByLikelihood', () => {
  const items = [
    t('a', 0.95),
    t('b', 0.82),
    t('c', 0.76),
    t('d', 0.40),
  ];

  it('orders strongest first and held back last', () => {
    expect(groupByLikelihood(items, 0.75).map((g) => g.key)).toEqual([
      'strong', 'likely', 'marginal', 'held',
    ]);
  });

  it('orders items inside a band by score', () => {
    const all = groupByLikelihood([t('a', 0.80), t('b', 0.90), t('c', 0.85)], 0.45);
    expect(all[0].items.map((i) => i.score)).toEqual([0.9, 0.85, 0.8]);
  });

  it('omits a band with nothing in it rather than rendering an empty header', () => {
    expect(groupByLikelihood([t('a', 0.95)], 0.75).map((g) => g.key)).toEqual(['strong']);
  });

  it('loses nothing', () => {
    const total = groupByLikelihood(items, 0.75).reduce((a, g) => a + g.items.length, 0);
    expect(total).toBe(items.length);
  });
});
