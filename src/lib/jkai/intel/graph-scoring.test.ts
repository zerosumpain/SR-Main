// Pure helpers added to the extraction pipeline: edge weighting and the
// evidence excerpt. Both are written on every ingest, so a regression here
// silently degrades the whole graph rather than throwing.
import { describe, it, expect } from 'vitest';
import { weightFor, strengthBucket, findExcerpt, normaliseTypeName } from './graph';

describe('weightFor', () => {
  it('rises with corroboration and never falls', () => {
    let previous = 0;
    for (let observations = 1; observations <= 20; observations++) {
      const w = weightFor(observations, 'medium');
      expect(w).toBeGreaterThanOrEqual(previous);
      previous = w;
    }
  });

  it('ranks confidence correctly at equal corroboration', () => {
    expect(weightFor(1, 'high')).toBeGreaterThan(weightFor(1, 'medium'));
    expect(weightFor(1, 'medium')).toBeGreaterThan(weightFor(1, 'low'));
  });

  it('stays within 0..1 even at absurd observation counts', () => {
    expect(weightFor(10_000, 'high')).toBeLessThanOrEqual(1);
    expect(weightFor(1, 'low')).toBeGreaterThan(0);
  });

  it('saturates — the tenth observation adds less than the second', () => {
    // The point of the exponential: one independent corroboration is a real
    // signal, the thirtieth is not.
    const early = weightFor(2, 'medium') - weightFor(1, 'medium');
    const late = weightFor(11, 'medium') - weightFor(10, 'medium');
    expect(early).toBeGreaterThan(late);
  });

  it('treats an unknown confidence string as medium rather than throwing', () => {
    expect(weightFor(1, 'nonsense')).toBe(weightFor(1, 'medium'));
  });
});

describe('strengthBucket', () => {
  it('maps the weight range onto the three display buckets', () => {
    expect(strengthBucket(0.9)).toBe('strong');
    expect(strengthBucket(0.5)).toBe('moderate');
    expect(strengthBucket(0.2)).toBe('weak');
  });

  it('is monotonic across the boundaries', () => {
    const order = { weak: 0, moderate: 1, strong: 2 } as const;
    let previous = -1;
    for (let w = 0; w <= 1.0001; w += 0.05) {
      const rank = order[strengthBucket(w) as keyof typeof order];
      expect(rank).toBeGreaterThanOrEqual(previous);
      previous = rank;
    }
  });
});

describe('findExcerpt', () => {
  const note =
    'The board met on Tuesday. John Kelly presented the IBCA Data Strategy to the committee. ' +
    'It was approved unanimously.';

  it('returns the sentence the entity was asserted in', () => {
    const out = findExcerpt(note, 'IBCA Data Strategy');
    expect(out).toContain('John Kelly presented the IBCA Data Strategy');
    expect(out).not.toContain('The board met on Tuesday');
  });

  it('matches case-insensitively', () => {
    expect(findExcerpt(note, 'ibca data strategy')).toBeTruthy();
  });

  it('returns null when the entity does not appear', () => {
    expect(findExcerpt(note, 'Department for Transport')).toBeNull();
  });

  it('returns null for empty input rather than an empty quote', () => {
    expect(findExcerpt('', 'IBCA')).toBeNull();
    expect(findExcerpt(note, '')).toBeNull();
  });

  it('collapses whitespace so a wrapped source reads as one sentence', () => {
    const wrapped = 'A claim about\n   IBCA   spanning\nlines.';
    expect(findExcerpt(wrapped, 'IBCA')).toBe('A claim about IBCA spanning lines.');
  });

  it('falls back to a window when there is no sentence boundary nearby', () => {
    const noStops = 'x'.repeat(500) + ' IBCA ' + 'y'.repeat(500);
    const out = findExcerpt(noStops, 'IBCA')!;
    expect(out).toContain('IBCA');
    expect(out.length).toBeLessThanOrEqual(301);
  });

  it('never exceeds the cap', () => {
    const long = `${'word '.repeat(200)}IBCA${' word'.repeat(200)}.`;
    expect(findExcerpt(long, 'IBCA')!.length).toBeLessThanOrEqual(300);
  });
});

describe('normaliseTypeName', () => {
  it('collapses the ways a model spells the same type', () => {
    const forms = ['Data Source', 'data-source', 'data_sources', 'DATA SOURCE'];
    const normalised = new Set(forms.map(normaliseTypeName));
    expect(normalised.size).toBe(1);
  });

  it('keeps genuinely different types apart', () => {
    expect(normaliseTypeName('person')).not.toBe(normaliseTypeName('project'));
  });
});
