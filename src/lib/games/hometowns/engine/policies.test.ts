// Policy cards (spec §6.7): slots by tier, the Mayor's Initiative an
// enactment costs, the same-day undo, painted areas, the monthly money, what
// Helper Mode pauses, and that a card switched off leaves every system
// bit-identical to never having had it.

import { describe, expect, it } from 'vitest';
import { civicSteps, liveSteps, type CivicScript } from '../../../../../scripts/hometowns/civic-kit';
import { fixture } from '../../../../../scripts/hometowns/fixture';
import { runMonths } from '../../../../../scripts/hometowns/people-kit';
import { applyCommand } from './commands';
import { POLICIES } from './content';
import { lineIndex, population } from './core';
import { stateHash } from './index';
import { policyMove, policySlots } from './policies';
import { MARK_AFFORDABLE, MARK_DAMAGED, MARK_HERITAGE, marksAt, pairSet, tileIndex } from './tiles';
import { EngineError, type CountyState } from './types';

function refused(f: () => unknown, status: number, text?: RegExp): void {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(EngineError);
    expect((e as EngineError).status).toBe(status);
    if (text) expect((e as Error).message).toMatch(text);
    return;
  }
  throw new Error('expected a refusal');
}

function town(kind: 'hamlet' | 'town' | 'metropolis' = 'town') {
  const f = fixture(kind);
  const t = f.county.towns[f.town];
  t.initiatives = 6;
  return { c: f.county, i: f.town, t, now: f.now };
}

let n = 0;
const policy = (c: CountyState, seat: string, card: string, on: boolean, now: number, area?: number[]) => applyCommand(c, seat, { type: 'policy', moveId: `p${n++}`, card, on, area }, now);

const RICH: CivicScript = { housing: { rent: [300, 450, 800], occ: [1000, 2000, 500] }, firms: { turnover: 10_000_000 }, travel: { busShare: 0.2 }, labour: { employed: [2000, 2000, 1000] } };

describe('enacting and repealing', () => {
  it('costs one Initiative, and a same-day repeal gives it back', () => {
    const { c, t, now } = town();
    policy(c, t.seat, 'litterPickers', true, now);
    expect(t.initiatives).toBe(5);
    expect(t.policies.map((a) => a.card)).toEqual(['litterPickers']);
    expect(t.policies[0].sinceDay).toBe(c.dayIndex);
    policy(c, t.seat, 'litterPickers', false, now);
    expect(t.initiatives).toBe(6);
    expect(t.policies).toEqual([]);
    // On a later day, repealing is free but the Initiative is spent.
    policy(c, t.seat, 'litterPickers', true, now);
    t.policies[0].sinceDay = c.dayIndex - 1;
    policy(c, t.seat, 'litterPickers', false, now);
    expect(t.initiatives).toBe(5);
  });

  it('respects the card tier, the slots per tier and the Initiatives in hand', () => {
    const v = town('hamlet');
    refused(() => policy(v.c, v.t.seat, 'litterPickers', true, v.now), 409, /unlocks at Village|slots/);
    v.t.tier = 1;
    refused(() => policy(v.c, v.t.seat, 'cleanAirRules', true, v.now), 409, /unlocks at Town/);
    policy(v.c, v.t.seat, 'litterPickers', true, v.now);
    policy(v.c, v.t.seat, 'smokeAlarms', true, v.now);
    expect(policySlots(1)).toBe(2);
    refused(() => policy(v.c, v.t.seat, 'neighbourhoodWatch', true, v.now), 409, /slots are full/);
    refused(() => policy(v.c, v.t.seat, 'litterPickers', true, v.now), 409, /already/);
    const { c, t, now } = town();
    t.initiatives = 0;
    refused(() => policy(c, t.seat, 'treePlanting', true, now), 409, /Initiative/);
    refused(() => policy(c, t.seat, 'noSuchCard', true, now), 400);
    refused(() => policy(c, t.seat, 'treePlanting', false, now), 409, /not in force/);
  });

  it('paints an area for the painted cards, keeping every other mark', () => {
    const { c, t, now } = town();
    refused(() => policy(c, t.seat, 'keepHomesAffordable', true, now), 400, /rectangles/);
    refused(() => policy(c, t.seat, 'keepHomesAffordable', true, now, [60, 60, 8, 8]), 400, /map/);
    refused(() => policy(c, t.seat, 'litterPickers', true, now, [0, 0, 2, 2]), 400, /whole town/);
    pairSet(t.marks, tileIndex(10, 10), MARK_DAMAGED);
    const before = [...t.marks];
    policy(c, t.seat, 'keepHomesAffordable', true, now, [8, 8, 4, 4, 30, 30, 1, 1]);
    expect(marksAt(t, tileIndex(10, 10))).toBe(MARK_DAMAGED | MARK_AFFORDABLE);
    expect(marksAt(t, tileIndex(30, 30))).toBe(MARK_AFFORDABLE);
    expect(marksAt(t, tileIndex(12, 12))).toBe(0);
    t.tier = 3;
    policy(c, t.seat, 'heritageProtection', true, now, [9, 9, 2, 2]);
    expect(marksAt(t, tileIndex(10, 10))).toBe(MARK_DAMAGED | MARK_AFFORDABLE | MARK_HERITAGE);
    policy(c, t.seat, 'keepHomesAffordable', false, now);
    policy(c, t.seat, 'heritageProtection', false, now);
    expect(t.marks).toEqual(before);
  });

  it('refuses money-costing cards in Helper Mode, but not free ones', () => {
    const { c, t, now } = town();
    t.money.helper = { sinceDay: 0, sinceTick: 0, advance: 1000, step: 0 };
    refused(() => policy(c, t.seat, 'treePlanting', true, now), 409, /paused/);
    policy(c, t.seat, 'cleanAirRules', true, now);
    expect(t.policies.map((a) => a.card)).toEqual(['cleanAirRules']);
  });

  it('is a direct handler as well as a move (the page and bots predict with it)', () => {
    const { c, i, t } = town();
    const r = policyMove(c, i, { type: 'policy', moveId: 'x', card: 'nightMarket', on: true });
    expect(r.atTick).toBe(t.tick);
    expect(t.policies[0].card).toBe('nightMarket');
  });
});

describe('the monthly money', () => {
  const run = (cards: string[]) => {
    const { c, i, t } = town();
    for (const card of cards) t.policies.push({ card, sinceTick: 0, sinceDay: 0, area: null });
    const [d] = runMonths(c, i, 1, civicSteps(RICH));
    return { lines: d.ledger!.lines, N: population(t) };
  };
  it('charges per resident, flat or earns, as printed on the card', () => {
    const none = run([]);
    const per = run(['litterPickers']);
    expect(per.lines[lineIndex('policyCosts')]).toBe(-Math.trunc(0.2 * per.N)); // the carry keeps the pence
    expect(run(['farmersMarket']).lines[lineIndex('policyCosts')]).toBe(-5000);
    const nm = run(['nightMarket']);
    expect(nm.lines[lineIndex('policyCosts')]).toBe(Math.trunc(0.2 * nm.N));
    expect(none.lines[lineIndex('policyCosts')]).toBe(0);
    // Free Bus Fridays waives a seventh of the bus fares.
    const fares = none.lines[lineIndex('fares')];
    const free = run(['freeBusFridays']).lines[lineIndex('fares')];
    expect(fares).toBeGreaterThan(1000);
    expect(Math.abs(free - fares * (1 - 1 / 7))).toBeLessThanOrEqual(1);
  });
  it('covers every card in the catalogue with a known cost kind', () => {
    for (const p of POLICIES) expect(['perResident', 'flat', 'free', 'earnsPerResident', 'fares']).toContain(p.cost.kind);
  });
});

describe('a card switched off is bit-identical to never having had it', () => {
  it.each(['litterPickers', 'nightMarket', 'cleanAirRules', 'freeBusFridays', 'keepHomesAffordable'])('%s, over months of the scripted economy', (card) => {
    const a = town();
    const b = town();
    const painted = POLICIES.find((p) => p.id === card)!.painted ? [8, 8, 6, 6] : undefined;
    policy(b.c, b.t.seat, card, true, b.now, painted);
    policy(b.c, b.t.seat, card, false, b.now);
    runMonths(a.c, a.i, 24, civicSteps(RICH));
    runMonths(b.c, b.i, 24, civicSteps(RICH));
    expect(stateHash(b.t)).toBe(stateHash(a.t));
  });

  it('with every landed package live (and on, it does change the town)', () => {
    const a = town();
    const b = town();
    const on = town();
    policy(b.c, b.t.seat, 'nightMarket', true, b.now);
    policy(b.c, b.t.seat, 'nightMarket', false, b.now);
    policy(on.c, on.t.seat, 'nightMarket', true, on.now);
    for (const s of [a, b, on]) runMonths(s.c, s.i, 6, liveSteps());
    expect(stateHash(b.t)).toBe(stateHash(a.t));
    expect(stateHash(on.t)).not.toBe(stateHash(a.t));
  });
});
