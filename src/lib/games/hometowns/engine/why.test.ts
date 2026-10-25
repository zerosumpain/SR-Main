import { describe, expect, it } from 'vitest';
import { MonthWhy, QUANTITIES, TERMS, commitWhy, foldWhyDay, readWhy } from './why';
import type { TownState } from './types';

const town = () => ({ why: '' }) as TownState;

describe('the Why writer', () => {
  it('keeps the top three |amount| terms and the residual', () => {
    const w = new MonthWhy();
    w.add('pop.births', 5);
    w.add('pop.deaths', -2);
    w.add('pop.arrivals', 40);
    w.add('pop.leavers', -12);
    w.add('pop.births', 1);
    w.set('pop', 30);
    const [e] = w.entries();
    expect(e.q).toBe('pop');
    expect(e.v).toBe(30);
    expect(e.terms).toEqual([['pop.arrivals', 40], ['pop.leavers', -12], ['pop.births', 6]]);
    expect(e.rest).toBe(30 - 34);
    expect(w.problems).toEqual([]);
  });

  it('routes family terms to the named quantity and money terms by sign', () => {
    const w = new MonthWhy();
    w.add('mig.in.schools', 12, 'arrive.fM');
    w.add('money.homesTax', 3000);
    w.add('money.upkeepCivic', -2000);
    const qs = w.entries().map((e) => e.q);
    expect(qs).toEqual(['arrive.fM', 'revenue', 'spending']);
  });

  it('reports unknown keys and mismatches instead of throwing', () => {
    const w = new MonthWhy();
    w.add('no.such.term', 1);
    w.add('mig.in.schools', 1); // a family term needs its quantity
    w.add('pop.births', 1, 'revenue');
    expect(w.problems).toHaveLength(3);
  });

  it('packs, rings and folds days', () => {
    const t = town();
    for (let m = 0; m < 5; m++) {
      const w = new MonthWhy();
      w.add('pop.births', 2);
      w.add('vis.season', 100);
      w.set('meter.homesL', 40 + m);
      commitWhy(t, w, m);
    }
    let r = readWhy(t);
    expect(r.monthly.map((x) => x.at)).toEqual([3, 4]);
    expect(r.today.months).toBe(5);
    expect(r.today.entries.find((e) => e.q === 'pop')!.v).toBe(10);
    foldWhyDay(t, 0);
    r = readWhy(t);
    expect(r.daily).toHaveLength(1);
    expect(r.today.months).toBe(0);
    // Meters average over the day; counts sum.
    expect(r.daily[0].entries.find((e) => e.q === 'meter.homesL')!.v).toBe(42);
    expect(r.daily[0].entries.find((e) => e.q === 'visitors')!.v).toBe(500);
    for (let d = 1; d < 10; d++) foldWhyDay(t, d);
    expect(readWhy(t).daily).toHaveLength(1); // empty days are not stored
  });

  it('has unique keys (the copy checklist)', () => {
    expect(new Set(TERMS.map((t) => t.key)).size).toBe(TERMS.length);
    expect(new Set(QUANTITIES.map((q) => q.id)).size).toBe(QUANTITIES.length);
    expect(TERMS.length).toBeLessThan(65536);
  });
});
