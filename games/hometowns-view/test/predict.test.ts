// Exact local ticks and the canary (spec §10.9, §10.4 item 8): a page that
// predicts its town from the frame's inputs reaches the server's exact hash
// tick by tick, stops at the Regional Day, and a wrong prediction switches
// prediction off.

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../scripts/hometowns/fixture';
import { catchUpTown, gridEndAt, gridTickAt, nextRegionalDayAt, paramsFor, stateHash, type TownState } from '../src/engine';
import { Predictor } from '../src/core/predict';

function setup(kind: 'hamlet' | 'town') {
  const f = fixture(kind);
  const c = f.county;
  const i = f.town;
  const p = paramsFor(c.paramsVersion);
  const g = gridTickAt(c, f.now);
  catchUpTown(c, i, g);
  const R = nextRegionalDayAt(c, p.clock.devRegionalTicks);
  const clock = { tickMs: c.tickMs, gridTick: g, nextTickAt: gridEndAt(c, g), nextRegionalDayAt: R, paused: false, napping: false };
  const info = { townIndex: i, dayIndex: c.dayIndex, rivalry: c.settings.rivalry, mishaps: c.settings.mishaps, paramsVersion: c.paramsVersion };
  const page = new Predictor(JSON.parse(JSON.stringify(c.towns[i])) as TownState, info, c.snapshot, clock);
  return { c, i, page, clock, R, now: f.now };
}

describe('Predictor', () => {
  it('runs the same ticks as the server, with the same hashes', () => {
    const { c, i, page, clock, R } = setup('town');
    const until = Math.min(R, clock.nextTickAt + 5 * clock.tickMs);
    const ran = page.advance(until);
    expect(ran).toBeGreaterThan(0);
    catchUpTown(c, i, gridTickAt(c, until));
    expect(page.town.tick).toBe(c.towns[i].tick);
    const r = page.check(c.towns[i].tick, stateHash(c.towns[i]));
    expect(r).toEqual({ tick: c.towns[i].tick, ok: true, hash: stateHash(c.towns[i]) });
    expect(page.enabled).toBe(true);
  });

  it('runs nothing before the next boundary, and nothing past the Regional Day', () => {
    const { page, clock, R } = setup('hamlet');
    expect(page.advance(clock.nextTickAt - 1)).toBe(0);
    let total = 0;
    for (let k = 0; k < 400 && page.nextDue() !== null; k++) total += page.advance(R + 10 * clock.tickMs);
    expect(page.nextDue()).toBeNull();
    // The last tick it ran ended at or before the Regional Day.
    expect(clock.nextTickAt + (total - 1) * clock.tickMs).toBeLessThanOrEqual(R);
  });

  it('turns itself off on a canary mismatch, and says nothing for a tick it did not predict', () => {
    const { page, clock } = setup('hamlet');
    page.advance(clock.nextTickAt);
    const tick = page.town.tick;
    expect(page.check(tick + 50, 'abc')).toBeNull();
    expect(page.check(tick, 'not-the-hash')).toMatchObject({ tick, ok: false });
    expect(page.enabled).toBe(false);
    expect(page.nextDue()).toBeNull();
  });

  it('waits for the server rather than running a long backlog on the main thread', () => {
    const { page, clock } = setup('town');
    expect(page.advance(clock.nextTickAt + 20 * clock.tickMs)).toBe(0);
    // Nothing to wake for until a frame resets the town.
    expect(page.nextDue()).toBeNull();
  });

  it('never compares the server with a prediction made from the town a reset replaced', () => {
    const { page, clock, c, i } = setup('hamlet');
    const info = { townIndex: i, dayIndex: c.dayIndex, rivalry: c.settings.rivalry, mishaps: c.settings.mishaps, paramsVersion: c.paramsVersion };
    const start = JSON.parse(JSON.stringify(c.towns[i])) as TownState;
    page.advance(clock.nextTickAt);
    const tick = page.town.tick;
    // A new frame at the old tick (a move from the app changed the inputs): the old prediction of `tick` is gone.
    page.reset(JSON.parse(JSON.stringify(start)) as TownState, info, c.snapshot, clock);
    expect(page.check(tick, 'whatever')).toBeNull();
    expect(page.enabled).toBe(true);
  });

  it('records no canary hashes while an unconfirmed local change is applied', () => {
    const { page, clock } = setup('hamlet');
    page.dirty = true;
    page.advance(clock.nextTickAt);
    expect(page.check(page.town.tick, stateHash(page.town))).toBeNull();
  });
});
