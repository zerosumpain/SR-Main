import { describe, it, expect } from 'vitest';
import {
  ageInDays,
  bestGrade,
  computeConfidence,
  corroborationFraction,
  credibilityFraction,
  credibilityFromCorroboration,
  gradeFromSource,
  gradeLabel,
  normalizeCredibility,
  normalizeGrade,
  orderedComponents,
  recencyDecay,
  reliabilityFraction,
  splitOnTerm,
  TRUST_MODEL,
  UNASSESSED_SCORE,
  type ConfidenceInput,
} from './trust';

const DAY = 86_400_000;

function score(over: ConfidenceInput = {}): number {
  return computeConfidence({ corroboration: 2, sourceGrade: 'C', credibility: 3, ageDays: 0, ...over })
    .score;
}

describe('gradeFromSource', () => {
  it('grades first-party capture above third-party documents above raw web', () => {
    expect(gradeFromSource('pwa')).toBe('A');
    expect(gradeFromSource('whatsapp')).toBe('A');
    expect(gradeFromSource('file')).toBe('B');
    expect(gradeFromSource('email')).toBe('B');
    expect(gradeFromSource('research')).toBe('B');
    expect(gradeFromSource('web')).toBe('C');
    expect(gradeFromSource('workflow')).toBe('C');
  });

  it('falls back to F (unassessed) for anything unrecognised', () => {
    expect(gradeFromSource('carrier-pigeon')).toBe('F');
    expect(gradeFromSource('')).toBe('F');
    expect(gradeFromSource(undefined as unknown as string)).toBe('F');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(gradeFromSource(' WhatsApp ')).toBe('A');
  });
});

describe('bestGrade', () => {
  it('takes the most reliable source rather than the average', () => {
    expect(bestGrade(['web', 'web', 'web', 'whatsapp'])).toBe('A');
    expect(bestGrade(['web', 'file'])).toBe('B');
  });

  it('never lets an unassessed source displace a real grade', () => {
    expect(bestGrade(['carrier-pigeon', 'web'])).toBe('C');
  });

  it('returns F when nothing is assessable', () => {
    expect(bestGrade([])).toBe('F');
    expect(bestGrade(['carrier-pigeon'])).toBe('F');
  });
});

describe('credibilityFromCorroboration', () => {
  it('walks down the Admiralty ladder as independent sources accumulate', () => {
    expect(credibilityFromCorroboration(0)).toBe(6); // cannot be judged
    expect(credibilityFromCorroboration(1)).toBe(3); // possibly true
    expect(credibilityFromCorroboration(2)).toBe(2); // probably true
    expect(credibilityFromCorroboration(3)).toBe(1); // confirmed
    expect(credibilityFromCorroboration(50)).toBe(1);
  });

  it('tolerates junk input', () => {
    expect(credibilityFromCorroboration(-4)).toBe(6);
    expect(credibilityFromCorroboration(NaN)).toBe(6);
  });
});

describe('axis fractions', () => {
  it('maps A–E linearly onto 1..0', () => {
    expect(reliabilityFraction('A')).toBe(1);
    expect(reliabilityFraction('C')).toBe(0.5);
    expect(reliabilityFraction('E')).toBe(0);
  });

  it('treats F as neutral, not as the bottom of the scale', () => {
    expect(reliabilityFraction('F')).toBe(TRUST_MODEL.neutral);
    expect(reliabilityFraction('F')).toBeGreaterThan(reliabilityFraction('E'));
  });

  it('maps 1–5 linearly and treats 6 as neutral', () => {
    expect(credibilityFraction(1)).toBe(1);
    expect(credibilityFraction(3)).toBe(0.5);
    expect(credibilityFraction(5)).toBe(0);
    expect(credibilityFraction(6)).toBe(TRUST_MODEL.neutral);
    expect(credibilityFraction(6)).toBeGreaterThan(credibilityFraction(5));
  });

  it('saturates corroboration without ever reaching certainty', () => {
    expect(corroborationFraction(0)).toBe(0);
    expect(corroborationFraction(TRUST_MODEL.corroborationK)).toBeCloseTo(0.5, 10);
    expect(corroborationFraction(1000)).toBeLessThan(1);
    // The second source adds far more than the tenth.
    const first = corroborationFraction(2) - corroborationFraction(1);
    const tenth = corroborationFraction(10) - corroborationFraction(9);
    expect(first).toBeGreaterThan(tenth * 5);
  });
});

describe('normalisation', () => {
  it('coerces unknown grades and ratings to their neutral value', () => {
    expect(normalizeGrade('b')).toBe('B');
    expect(normalizeGrade(' a ')).toBe('A');
    expect(normalizeGrade('Z')).toBe('F');
    expect(normalizeGrade(null)).toBe('F');
    expect(normalizeCredibility('2')).toBe(2);
    expect(normalizeCredibility(0)).toBe(6);
    expect(normalizeCredibility(9)).toBe(6);
    expect(normalizeCredibility(null)).toBe(6);
  });
});

describe('recencyDecay', () => {
  it('is 1 for fresh or future-dated evidence', () => {
    expect(recencyDecay(0)).toBe(1);
    expect(recencyDecay(-30)).toBe(1);
    expect(recencyDecay(NaN)).toBe(1);
  });

  it('halves the decayable range every half-life', () => {
    const floor = TRUST_MODEL.decayFloor;
    const span = 1 - floor;
    expect(recencyDecay(TRUST_MODEL.halfLifeDays)).toBeCloseTo(floor + span / 2, 10);
    expect(recencyDecay(TRUST_MODEL.halfLifeDays * 2)).toBeCloseTo(floor + span / 4, 10);
  });

  it('is monotonically decreasing and floored', () => {
    let prev = recencyDecay(0);
    for (const d of [10, 100, 365, 730, 3650, 36500]) {
      const next = recencyDecay(d);
      expect(next).toBeLessThan(prev);
      expect(next).toBeGreaterThanOrEqual(TRUST_MODEL.decayFloor);
      prev = next;
    }
  });
});

describe('computeConfidence', () => {
  it('components sum exactly to the score', () => {
    for (const input of [
      { corroboration: 0, sourceGrade: 'F', credibility: 6, ageDays: 0, confirmed: false },
      { corroboration: 3, sourceGrade: 'A', credibility: 1, ageDays: 0, confirmed: true },
      { corroboration: 7, sourceGrade: 'D', credibility: 4, ageDays: 900, confirmed: true },
      { corroboration: 1, sourceGrade: 'C', credibility: 3, ageDays: 200, confirmed: false },
    ] satisfies ConfidenceInput[]) {
      const r = computeConfidence(input);
      const sum = Object.values(r.components).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(r.score, 10);
    }
  });

  it('stays within 0..1 across the whole input space', () => {
    for (const grade of ['A', 'B', 'C', 'D', 'E', 'F']) {
      for (const cred of [1, 2, 3, 4, 5, 6]) {
        for (const corr of [0, 1, 5, 100]) {
          for (const age of [0, 400, 5000]) {
            for (const confirmed of [true, false]) {
              const r = computeConfidence({
                sourceGrade: grade,
                credibility: cred,
                corroboration: corr,
                ageDays: age,
                confirmed,
              });
              expect(r.score).toBeGreaterThanOrEqual(0);
              expect(r.score).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it('approaches but never reaches 1, because repetition is not proof', () => {
    const best = { sourceGrade: 'A', credibility: 1, ageDays: 0, confirmed: true } as const;
    expect(score({ ...best, corroboration: 20 })).toBeLessThan(1);
    expect(score({ ...best, corroboration: 20 })).toBeGreaterThan(0.95);
    expect(score({ ...best, corroboration: 1e6 })).toBeLessThan(1);
  });

  it('rejects non-finite corroboration instead of poisoning the score', () => {
    // Infinity survives a `|| 0` guard and turns the saturating curve into NaN.
    expect(computeConfidence({ corroboration: Infinity }).resolved.corroboration).toBe(0);
    expect(computeConfidence({ corroboration: NaN }).resolved.corroboration).toBe(0);
    expect(score({ corroboration: Infinity })).toBeGreaterThan(0);
  });

  it('bottoms out at 0 for the worst assessable evidence', () => {
    expect(score({ sourceGrade: 'E', credibility: 5, corroboration: 0, confirmed: false })).toBe(0);
  });

  it('never lowers the score when corroboration increases (monotonicity)', () => {
    for (const grade of ['A', 'C', 'E', 'F']) {
      for (const age of [0, 365, 4000]) {
        let prev = -1;
        for (const corr of [0, 1, 2, 3, 5, 8, 13, 21, 50]) {
          const s = score({ sourceGrade: grade, corroboration: corr, ageDays: age });
          expect(s).toBeGreaterThan(prev);
          prev = s;
        }
      }
    }
  });

  it('is monotonic in source reliability and credibility', () => {
    const grades = ['A', 'B', 'C', 'D', 'E'] as const;
    for (let i = 1; i < grades.length; i++) {
      expect(score({ sourceGrade: grades[i - 1] })).toBeGreaterThan(score({ sourceGrade: grades[i] }));
    }
    for (let c = 2; c <= 5; c++) {
      expect(score({ credibility: c - 1 })).toBeGreaterThan(score({ credibility: c }));
    }
  });

  it('weakens with age', () => {
    const fresh = score({ ageDays: 7 });
    const year = score({ ageDays: 365 });
    const twoYears = score({ ageDays: 730 });
    expect(year).toBeLessThan(fresh);
    expect(twoYears).toBeLessThan(year);
    // The stated rule: two years ago is meaningfully weaker than last week.
    expect(twoYears).toBeLessThan(fresh * 0.8);
  });

  it('reports age as a negative component that is zero when fresh', () => {
    expect(computeConfidence({ corroboration: 3, ageDays: 0 }).components.recency).toBe(0);
    expect(computeConfidence({ corroboration: 3, ageDays: 900 }).components.recency).toBeLessThan(0);
  });

  it('does not decay human confirmation', () => {
    const ancient = computeConfidence({
      corroboration: 3,
      sourceGrade: 'B',
      ageDays: 5000,
      confirmed: true,
    });
    expect(ancient.components.confirmation).toBe(TRUST_MODEL.weights.confirmation);
  });

  it('treats an unknown grade neutrally rather than as a penalty', () => {
    const unknown = score({ sourceGrade: null });
    expect(unknown).toBeGreaterThan(score({ sourceGrade: 'E' }));
    expect(unknown).toBeLessThan(score({ sourceGrade: 'A' }));
    expect(unknown).toBe(score({ sourceGrade: 'C' })); // C is the midpoint
    expect(score({ credibility: null })).toBe(score({ credibility: 3 }));
  });

  it('defaults missing input to the fully-unassessed case', () => {
    const empty = computeConfidence({});
    expect(empty.resolved).toEqual({
      sourceGrade: 'F',
      credibility: 6,
      corroboration: 0,
      ageDays: 0,
      confirmed: false,
    });
    expect(empty.score).toBeCloseTo(UNASSESSED_SCORE, 10);
    // "Nothing is known" must not read as "low confidence" — that would be a
    // claim about the evidence which the evidence does not support.
    expect(empty.label).toBe('unverified');
  });

  it('separates "nothing known" from "one weak source"', () => {
    const nothing = computeConfidence({});
    const oneWebNote = computeConfidence({
      sourceGrade: gradeFromSource('web'),
      credibility: credibilityFromCorroboration(1),
      corroboration: 1,
    });
    expect(nothing.label).toBe('unverified');
    expect(oneWebNote.label).toBe('low');
    expect(oneWebNote.score).toBeGreaterThan(nothing.score);
  });

  it('ignores negative and non-finite input', () => {
    expect(computeConfidence({ corroboration: -5 }).resolved.corroboration).toBe(0);
    expect(computeConfidence({ ageDays: -100 }).decay).toBe(1);
    expect(computeConfidence({ ageDays: NaN }).decay).toBe(1);
  });
});

describe('gradeLabel', () => {
  it('buckets the score', () => {
    expect(gradeLabel(0.9)).toBe('high');
    expect(gradeLabel(0.75)).toBe('high');
    expect(gradeLabel(0.6)).toBe('moderate');
    expect(gradeLabel(0.5)).toBe('moderate');
    expect(gradeLabel(0.3)).toBe('low');
    expect(gradeLabel(UNASSESSED_SCORE)).toBe('unverified');
    expect(gradeLabel(UNASSESSED_SCORE + 1e-9)).toBe('low');
    expect(gradeLabel(0.1)).toBe('unverified');
    expect(gradeLabel(NaN)).toBe('unverified');
  });

  it('agrees with the label computeConfidence reports', () => {
    const r = computeConfidence({ corroboration: 4, sourceGrade: 'A', credibility: 1, confirmed: true });
    expect(r.label).toBe(gradeLabel(r.score));
    expect(r.label).toBe('high');
  });
});

describe('ageInDays', () => {
  const now = 1_800_000_000_000;

  it('measures days from a date, string or epoch', () => {
    expect(ageInDays(new Date(now - 10 * DAY), now)).toBeCloseTo(10, 10);
    expect(ageInDays(new Date(now - 10 * DAY).toISOString(), now)).toBeCloseTo(10, 10);
    expect(ageInDays(now - 2 * DAY, now)).toBeCloseTo(2, 10);
  });

  it('returns 0 for missing, unparseable or future timestamps', () => {
    expect(ageInDays(null, now)).toBe(0);
    expect(ageInDays('not a date', now)).toBe(0);
    expect(ageInDays(now + 5 * DAY, now)).toBe(0);
  });
});

describe('splitOnTerm', () => {
  it('marks every occurrence of the term', () => {
    expect(splitOnTerm('DfE ran it, then DfE stopped.', 'DfE')).toEqual([
      { text: 'DfE', hit: true },
      { text: ' ran it, then ', hit: false },
      { text: 'DfE', hit: true },
      { text: ' stopped.', hit: false },
    ]);
  });

  it('matches case-insensitively but preserves the original casing', () => {
    expect(splitOnTerm('the dfe said', 'DfE')).toEqual([
      { text: 'the ', hit: false },
      { text: 'dfe', hit: true },
      { text: ' said', hit: false },
    ]);
  });

  it('treats the term as literal text, not a pattern', () => {
    expect(splitOnTerm('uses C++ (2019) daily', 'C++ (2019)')).toEqual([
      { text: 'uses ', hit: false },
      { text: 'C++ (2019)', hit: true },
      { text: ' daily', hit: false },
    ]);
    // A regex-based implementation would throw or match nothing here.
    expect(splitOnTerm('a [b] c', '[b]').some((s) => s.hit)).toBe(true);
  });

  it('returns the whole string unmarked when there is no match or no term', () => {
    expect(splitOnTerm('nothing here', 'DfE')).toEqual([{ text: 'nothing here', hit: false }]);
    expect(splitOnTerm('nothing here', '')).toEqual([{ text: 'nothing here', hit: false }]);
    expect(splitOnTerm('nothing here', null)).toEqual([{ text: 'nothing here', hit: false }]);
  });

  it('returns nothing for an empty excerpt', () => {
    expect(splitOnTerm('', 'DfE')).toEqual([]);
    expect(splitOnTerm(null, 'DfE')).toEqual([]);
  });

  it('never loses or duplicates characters', () => {
    const text = 'Ofsted and OFSTED and ofsted';
    const joined = splitOnTerm(text, 'ofsted')
      .map((s) => s.text)
      .join('');
    expect(joined).toBe(text);
  });

  it('bails out of highlighting when case folding changes length', () => {
    // 'İ'.toLowerCase() is two code units, so offsets would no longer line up.
    const segments = splitOnTerm('İstanbul office', 'İstanbul');
    expect(segments).toEqual([{ text: 'İstanbul office', hit: false }]);
  });
});

describe('orderedComponents', () => {
  it('lists the positive drivers strongest-first with age decay last', () => {
    const r = computeConfidence({ corroboration: 5, sourceGrade: 'A', credibility: 1, ageDays: 700 });
    const ordered = orderedComponents(r.components);
    expect(ordered).toHaveLength(5);
    expect(ordered.at(-1)?.key).toBe('recency');
    const positives = ordered.slice(0, -1).map((c) => c.value);
    expect([...positives].sort((a, b) => b - a)).toEqual(positives);
    expect(ordered[0].label).toBeTruthy();
  });
});
