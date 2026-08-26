import { describe, it, expect } from 'vitest';
import { validateRuleSpec, FACT_KEYS, MAX_CONDITIONS, type RuleSpec } from './spec';
import { evaluateCondition, evaluateRule, renderTemplate, termScore } from './evaluate';
import type { Facts } from './facts';

function facts(over: Partial<Facts> = {}): Facts {
  const base = Object.fromEntries(FACT_KEYS.map((k) => [k, null])) as Facts;
  return {
    ...base,
    localHour: 14,
    localDay: 2,
    isWeekday: true,
    isHome: false,
    mode: 'still',
    atPlaceKind: 'cafe',
    atPlaceIsNamed: true,
    minutesAtCurrentPlace: 25,
    nearestPlaceDistanceM: 40,
    nearestPlaceKind: 'cafe',
    positionAgeMins: 2,
    trailSpanDays: 30,
    coverage24h: 0.9,
    coverage7d: 0.85,
    daysSinceWorkout: 4,
    sleepPerformance: 55,
    sleepDropFromBaseline: 22,
    offersLiveCount: 7,
    offersNearbyCount: 1,
    calendarBusyNext2h: false,
    calendarPartial: false,
    unnamedPlaceCount: 81,
    recurringInterestCount: 2,
    ...over,
  };
}

const validSpec: RuleSpec = {
  kind: 'long_cafe_stop',
  description: 'A long sit in a café after a bad night.',
  title: 'Long stop at {{place}}',
  explanation: 'You have been at {{place}} for {{minutesAtCurrentPlace}} minutes.',
  when: {
    all: [
      { fact: 'atPlaceKind', op: 'eq', value: 'cafe' },
      { fact: 'minutesAtCurrentPlace', op: 'gte', value: 20 },
    ],
  },
  base: 0.4,
  terms: [{ fact: 'minutesAtCurrentPlace', from: 20, to: 90, weight: 0.3 }],
  minTrailDays: 7,
  dedupe: 'place-day',
  rationale: 'Long café stops line up with poor sleep in the ledger.',
};

describe('validateRuleSpec — the allow-list is the safety story', () => {
  it('accepts a well-formed rule', () => {
    expect(validateRuleSpec(validSpec)).toEqual({ ok: true, errors: [] });
  });

  it('refuses a fact that is not on the allow-list', () => {
    // The whole point: a model cannot name anything the fact extractor did not
    // put in front of it. This is an allow-list, not a deny-list — there is no
    // escape to enumerate.
    const r = validateRuleSpec({
      ...validSpec,
      when: { fact: 'process.env.DATABASE_URL', op: 'eq', value: 'x' },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('allow-list');
  });

  it('refuses a condition shape it does not know', () => {
    const r = validateRuleSpec({ ...validSpec, when: { eval: 'fetch("http://x")' } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('all / any / not / fact');
  });

  it('refuses ordering comparisons on a string fact rather than coercing them', () => {
    // A validator that quietly accepts nonsense hides it until it fires.
    const r = validateRuleSpec({
      ...validSpec,
      when: { fact: 'mode', op: 'gt', value: 'walking' },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('only eq/neq');
  });

  it('refuses a type mismatch on the value', () => {
    expect(validateRuleSpec({ ...validSpec, when: { fact: 'isHome', op: 'eq', value: 'yes' } }).ok).toBe(false);
    expect(validateRuleSpec({ ...validSpec, when: { fact: 'localHour', op: 'gt', value: 'noon' } }).ok).toBe(false);
  });

  it('refuses a tree that nests too deep to be read', () => {
    let deep: unknown = { fact: 'localHour', op: 'gt', value: 1 };
    for (let i = 0; i < 8; i++) deep = { not: deep };
    const r = validateRuleSpec({ ...validSpec, when: deep });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('nests deeper');
  });

  it('refuses a fingerprint of one moment', () => {
    const many = Array.from({ length: MAX_CONDITIONS + 3 }, () => ({
      fact: 'localHour' as const,
      op: 'gte' as const,
      value: 1,
    }));
    const r = validateRuleSpec({ ...validSpec, when: { all: many } });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('more than');
  });

  it('refuses a rule that could score above 1 and outrank everything forever', () => {
    const r = validateRuleSpec({
      ...validSpec,
      base: 0.8,
      terms: [{ fact: 'minutesAtCurrentPlace', from: 0, to: 60, weight: 0.5 }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('must be ≤ 1');
  });

  it('refuses a score term on a non-numeric fact', () => {
    const r = validateRuleSpec({
      ...validSpec,
      terms: [{ fact: 'mode', from: 0, to: 1, weight: 0.2 }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('only numeric facts');
  });

  it('refuses a malformed kind', () => {
    expect(validateRuleSpec({ ...validSpec, kind: 'Bad Kind!' }).ok).toBe(false);
    expect(validateRuleSpec({ ...validSpec, kind: 'ab' }).ok).toBe(false);
  });

  it('refuses junk outright', () => {
    expect(validateRuleSpec(null).ok).toBe(false);
    expect(validateRuleSpec('a rule').ok).toBe(false);
  });
});

describe('evaluateCondition', () => {
  it('evaluates all / any / not', () => {
    const f = facts();
    expect(evaluateCondition({ all: [{ fact: 'localHour', op: 'gte', value: 10 }, { fact: 'isWeekday', op: 'eq', value: true }] }, f)).toBe(true);
    expect(evaluateCondition({ any: [{ fact: 'localHour', op: 'gt', value: 23 }, { fact: 'isHome', op: 'eq', value: false }] }, f)).toBe(true);
    expect(evaluateCondition({ not: { fact: 'isHome', op: 'eq', value: true } }, f)).toBe(true);
  });

  it('treats an unknown fact as FALSE for every comparison, including neq', () => {
    // The distinction the whole design rests on: `neq` on a null would make
    // "the sensor is down" satisfy "you are not at home".
    const f = facts({ isHome: null, daysSinceWorkout: null });
    expect(evaluateCondition({ fact: 'isHome', op: 'eq', value: false }, f)).toBe(false);
    expect(evaluateCondition({ fact: 'isHome', op: 'neq', value: true }, f)).toBe(false);
    expect(evaluateCondition({ fact: 'daysSinceWorkout', op: 'gte', value: 0 }, f)).toBe(false);
  });

  it('will not compare a string fact with an ordering operator at run time either', () => {
    const f = facts();
    expect(evaluateCondition({ fact: 'mode', op: 'gt', value: 'a' } as never, f)).toBe(false);
  });
});

describe('evaluateRule', () => {
  it('does not fire when the condition fails, and scores nothing', () => {
    const out = evaluateRule(validSpec, facts({ atPlaceKind: 'shop' }));
    expect(out.fired).toBe(false);
    expect(out.score).toBe(0);
  });

  it('fires and shows its working', () => {
    const out = evaluateRule(validSpec, facts({ minutesAtCurrentPlace: 55 }));
    expect(out.fired).toBe(true);
    // base 0.4 + ramp((55-20)/70)=0.5 * 0.3 = 0.55
    expect(out.score).toBeCloseTo(0.55, 2);
    expect(out.components.base).toBe(0.4);
    expect(out.components.minutesAtCurrentPlace).toBeCloseTo(0.15, 3);
  });

  it('clamps to 1 however the terms add up', () => {
    const out = evaluateRule(
      { ...validSpec, base: 1, terms: [{ fact: 'minutesAtCurrentPlace', from: 0, to: 1, weight: 1 }] },
      facts({ minutesAtCurrentPlace: 500 }),
    );
    expect(out.score).toBe(1);
  });

  it('scores a term as zero when its fact is unknown', () => {
    expect(termScore({ fact: 'daysSinceWorkout', from: 0, to: 10, weight: 0.5 }, facts({ daysSinceWorkout: null }))).toBe(0);
  });
});

describe('renderTemplate', () => {
  it('substitutes the place and any fact', () => {
    const out = renderTemplate(
      'You have been at {{place}} for {{minutesAtCurrentPlace}} minutes.',
      facts(),
      { label: 'The Test Cafe' },
    );
    expect(out).toBe('You have been at The Test Cafe for 25 minutes.');
  });

  it('leaves an unknown placeholder visible rather than blanking it', () => {
    // Visible nonsense is easier to fix than invisible nonsense — a blanked
    // token produces "You have been at  for  minutes".
    expect(renderTemplate('a {{nope}} b', facts(), { label: 'X' })).toBe('a {{nope}} b');
    expect(renderTemplate('a {{daysSinceWorkout}} b', facts({ daysSinceWorkout: null }), { label: 'X' })).toBe(
      'a {{daysSinceWorkout}} b',
    );
  });

  it('falls back when the place has no name', () => {
    expect(renderTemplate('at {{place}}', facts(), { label: null })).toBe('at this place');
  });
});
