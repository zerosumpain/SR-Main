// The harness's mayor (src/harness/bot.ts) is the Lab's Balanced bot: it
// takes Bramble's three steps at founding, plays legal, deterministic moves
// through the real move API, and grows a real town.

import { describe, expect, it } from 'vitest';
import { BOTS, CAT_ZONE, TILES, brambleCommands, checkTown, planesOf, roadAccess, useCat, usePayload, viewOf } from '../src/engine';
import { SESSION_MONTHS, botTurn, sessionRng } from '../src/harness/bot';
import { HarnessSession, HARNESS_SEAT } from '../src/harness/session';

describe('founding (Bramble’s three steps)', () => {
  it('draws a lane off the County Road, 12 Homes, 2 Farms and a Well, with no refusals', () => {
    const s = new HarnessSession({ seed: 1 });
    const t = s.town;
    const p = planesOf(t);
    let homes = 0;
    let farms = 0;
    for (let i = 0; i < TILES; i++)
      if (useCat(p.use[i]) === CAT_ZONE) {
        if (usePayload(p.use[i]) === 0) homes++;
        if (usePayload(p.use[i]) === 5) farms++;
      }
    expect([homes, farms]).toEqual([12, 2]);
    expect(t.buildings.map((b) => b[0])).toHaveLength(2); // the Town Hall and the Well
    expect(s.log.some((e) => e.text.includes('refused'))).toBe(false);
    // Every zoned lot can develop: a road within two tiles.
    const reach = roadAccess(t);
    for (let i = 0; i < TILES; i++) if (useCat(p.use[i]) === CAT_ZONE) expect(reach[i]).toBe(1);
  });

  it('is the engine’s own Bramble plan, on every site kind around Kingsport', () => {
    for (let site = 0; site < 6; site++) {
      const s = new HarnessSession({ seed: 11, site });
      let zoned = 0;
      const p = planesOf(s.town);
      for (let i = 0; i < TILES; i++) if (useCat(p.use[i]) === CAT_ZONE) zoned++;
      expect(zoned).toBeGreaterThanOrEqual(12);
    }
    // The same commands the Lab's bots take at founding.
    const fresh = new HarnessSession({ seed: 1 });
    expect(brambleCommands(viewOf(fresh.county, HARNESS_SEAT, fresh.now)!).length).toBeGreaterThan(0);
  });
});

describe('a bot town over ten days', () => {
  const s = new HarnessSession({ seed: 2, site: 2 });
  s.runDays(10);
  const t = s.town;

  it('grows past the Founding Fortnight into a Village', () => {
    const st = s.stats();
    expect(st.fortnight).toBe(false);
    expect(st.tier).toBeGreaterThanOrEqual(1);
    expect(st.population).toBeGreaterThan(500);
    expect(st.buildings).toBeGreaterThan(5);
  });

  it('keeps the town valid: invariants hold and no tick or month was reverted', () => {
    expect(checkTown(t)).toEqual([]);
    expect(t.alerts.filter((a) => a.kind === 'month-reverted' || a.kind === 'tick-reverted')).toEqual([]);
  });

  it('is a pure function of the seed (same seed, same town; another seed, another town)', () => {
    const again = new HarnessSession({ seed: 2, site: 2 });
    again.runDays(10);
    expect(again.hash()).toBe(s.hash());
    const other = new HarnessSession({ seed: 3, site: 2 });
    other.runDays(10);
    expect(other.hash()).not.toBe(s.hash());
  });

  it('plays only on session months, at most a Balanced session’s actions, and reports refusals instead of throwing', () => {
    expect(botTurn(s.county, 'nobody', s.now)).toEqual({ moves: [], refused: [], retry: false });
    expect(() => botTurn(s.county, HARNESS_SEAT, s.now)).not.toThrow();
    const turn = botTurn(s.county, HARNESS_SEAT, s.now + 7);
    const month = Math.floor(s.town.tick / 4);
    if (month % SESSION_MONTHS !== 0) expect(turn.moves).toEqual(['hello']);
    expect(turn.moves.length - 1).toBeLessThanOrEqual(BOTS.balanced.sessions.actions);
  });

  it('draws the same choices for the same session', () => {
    const a = sessionRng(9, 123_456_000);
    const b = sessionRng(9, 123_456_000);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});
