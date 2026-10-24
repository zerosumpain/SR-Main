// The §10.3 public API end to end through index.ts: what the adapter, the
// page and the bots import.

import { describe, expect, it } from 'vitest';
import { fixture, foundAndSprint, newCounty } from '../../../../../scripts/hometowns/fixture';
import * as E from './index';

describe('the public API', () => {
  it('exports the §10.3 surface', () => {
    for (const name of ['createCounty', 'foundTown', 'applyCommand', 'catchUp', 'regionalDay', 'tickTown', 'snapshotOf', 'forecast', 'stateHash', 'publicCard'] as const)
      expect(typeof E[name]).toBe('function');
    expect(E.ENGINE_HASH).toMatch(/^[0-9a-f]{16}$/);
    // A params hash is a hash of the params' content: equal content, equal hash; any change, a new one.
    const h = E.paramsHash(E.paramsFor('v1'));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(E.paramsHash(JSON.parse(JSON.stringify(E.paramsFor('v1'))))).toBe(h);
    const changed = JSON.parse(JSON.stringify(E.paramsFor('v1')));
    changed.develop.buildersBase += 1;
    expect(E.paramsHash(changed)).not.toBe(h);
  });

  it('runs the Regional Day steps in the §8.3 order and publishes the snapshot', () => {
    const c = newCounty(21);
    const { now } = foundAndSprint(c, 'ann', 0, c.epoch + 1000);
    const R = E.nextRegionalDayAt(c);
    E.catchUp(c, now, 1e9);
    expect(E.regionalDay(c, c.dayIndex + 1).ran).toBe(false); // not today's index
    E.catchUp(c, R - 1, 1e9);
    const report = E.regionalDay(c, c.dayIndex);
    expect(report.ran).toBe(true);
    expect(report.at).toBe(R);
    expect(report.steps).toEqual(E.STEPS.regional.map((s) => s.id));
    expect(c.dayIndex).toBe(1);
    expect(c.snapshot.dayIndex).toBe(0);
    expect(c.snapshot.worldSeed).toBe(c.seed);
    expect(c.snapshot.towns).toHaveLength(1);
    expect(c.snapshot.towns[0].active).toBe(true);
    expect(c.towns[0].tick).toBe(E.gridTickAt(c, R) - c.towns[0].gridBase!);
  });

  it('public cards carry no money, bonds, orders or contracts', () => {
    const f = fixture('town');
    const card = E.publicCard(f.county.towns[f.town]);
    const keys = JSON.stringify(card);
    for (const secret of ['reserves', 'bonds', 'orders', 'loan', 'contracts', 'books']) expect(keys).not.toContain(secret);
    expect(card.pop).toBe(E.population(f.county.towns[f.town]));
  });

  it('forecasts with and without a plan, and refuses an illegal plan without running', () => {
    const f = fixture('hamlet');
    const t = f.county.towns[f.town];
    const before = E.stateHash(t);
    const plan: E.Command = { type: 'build', planId: 'f1', plan: [{ op: 'place', id: 'pocketPark', x: 0, y: 0, rot: 0 }] };
    const bad = E.forecast(t, f.county.snapshot, plan, { months: 2, seeds: [1, 2] });
    expect(bad.refused).toMatch(/does not fit/);
    const ok = E.forecast(t, f.county.snapshot, null, { months: 2, seeds: [1, 2, 3] });
    expect(ok.refused).toBeNull();
    // With the people economy (WP2b) and development (WP2e) live, a day-old hamlet grows in two months
    // (level-ups, migration into the new homes, the last founders' carts); the range is ordered and close.
    const [lo, mid, hi] = ok.pop.without;
    expect(lo <= mid && mid <= hi).toBe(true);
    expect(Math.abs(mid - E.population(t)) / E.population(t)).toBeLessThan(0.3);
    expect(E.stateHash(t)).toBe(before); // forecasting never touches the town
  });
});
