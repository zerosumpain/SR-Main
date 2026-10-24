// The bot mayors (WP5, spec §11.1–§11.2) and their planner. Bots play
// through the move API like a phone, so the tests hold them to what a phone
// can do: every plan they make is legal on the town as it stands, they read
// the view without changing anything, and the same view and rng always give
// the same moves.

import { describe, expect, it } from 'vitest';
import { newCounty } from '../../../../../../scripts/hometowns/fixture';
import { applyCommand } from '../commands';
import { catchUp } from '../county';
import { nextRegionalDayAt } from '../clock';
import { hashOf } from '../hash';
import { BUILDINGS, buildingIndex } from '../content';
import { MAP, TILES, footprint, useCat, CAT_ROAD, roadAccess } from '../tiles';
import { EngineError, type Command, type CountyState, type Op } from '../types';
import { BOTS, BOT_IDS, botById, brambleCommands, viewOf, type BotId } from './index';
import { findSite, growRoads, isLattice, mapOf, pickLots, roadOps, utilityBalance, zoneCounts, zoneOps } from './planner';

const rngOf = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
};

/** A county with one founded town per bot, Bramble's steps done and the fortnight tapped through. */
function founded(bots: BotId[], seed = 3): { c: CountyState; now: number } {
  const c = newCounty(seed);
  const perSeat = c.settings.perSeat;
  bots.forEach((b, i) => (perSeat[`s${i}`] = { profile: BOTS[b].profile, pushes: false, pranks: false, answerOnly: false, assist: 'none' }));
  let now = nextRegionalDayAt(c) + 3_600_000;
  catchUp(c, now, Infinity);
  bots.forEach((_, i) => {
    applyCommand(c, `s${i}`, { type: 'found', site: i, nameParts: ['Oak', 'vale'], avatar: 'badger', flag: i }, now);
    for (const cmd of brambleCommands(viewOf(c, `s${i}`, now)!)) applyCommand(c, `s${i}`, cmd, now + 500);
  });
  for (let k = 0; k < 12; k++) {
    now += 10_000;
    bots.forEach((_, i) => applyCommand(c, `s${i}`, { type: 'sprint', moveId: `t${k}` }, now + i));
  }
  return { c, now: now + 60_000 };
}

/** Applies commands, returning the refusals (EngineError sentences) and any other error. */
function apply(c: CountyState, seat: string, cmds: Command[], now: number): { refused: string[]; errors: string[] } {
  const refused: string[] = [];
  const errors: string[] = [];
  cmds.forEach((cmd, k) => {
    try {
      applyCommand(c, seat, cmd, now + (k + 1) * 1000);
    } catch (e) {
      if (e instanceof EngineError) refused.push(`${cmd.type}: ${e.message}`);
      else errors.push(`${cmd.type}: ${String(e)}`);
    }
  });
  return { refused, errors };
}

describe('the planner', () => {
  it('puts every tile within two of a lattice road row', () => {
    for (let y = 0; y < MAP; y++) {
      let d = 99;
      for (let r = y - 2; r <= y + 2; r++) if (r >= 0 && r < MAP && r % 5 === 4) d = Math.min(d, Math.abs(r - y));
      if (y >= 2 && y <= 61) expect(d).toBeLessThanOrEqual(2);
    }
    expect(isLattice(32, 10)).toBe(true); // the County Road's column
    expect(isLattice(33, 44)).toBe(true); // the hall's row
    expect(isLattice(33, 43)).toBe(false);
  });

  it('grows roads on the lattice as one connected network from the County Road', () => {
    const { c, now } = founded(['balanced']);
    const t = c.towns[0];
    const m = mapOf(t);
    const g = growRoads(m, 30, 'lane', 1e9, viewOf(c, 's0', now)!.params);
    expect(g.tiles.length).toBe(30);
    // Every new tile touches an existing road or an earlier new tile.
    const road = new Uint8Array(TILES);
    for (let i = 0; i < TILES; i++) if (useCat(m.use[i]) === CAT_ROAD) road[i] = 1;
    for (const i of g.tiles) {
      const x = i % MAP;
      const y = (i - x) / MAP;
      expect(isLattice(x, y)).toBe(true);
      const touches = [i - 1, i + 1, i - MAP, i + MAP].some((j) => j >= 0 && j < TILES && road[j]);
      expect(touches).toBe(true);
      road[i] = 1;
    }
    // The ops it emits are straight runs the move API accepts.
    const ops = roadOps(g.tiles, 'lane');
    expect(ops.length).toBeLessThan(g.tiles.length);
    const r = applyCommand(c, 's0', { type: 'build', planId: 'roads', plan: ops }, now + 1000);
    expect(r.cost).toBe(g.cost);
  });

  it('picks only free lots in reach, off the lattice, and merges them into rows', () => {
    const { c } = founded(['balanced']);
    const t = c.towns[0];
    const m = mapOf(t);
    const reach = roadAccess(t, 2);
    const lots = pickLots(m, 0, 20);
    expect(lots.length).toBeGreaterThan(0);
    for (const i of lots) {
      expect(reach[i]).toBe(1);
      expect(m.use[i]).toBe(0);
      expect(isLattice(i % MAP, (i - (i % MAP)) / MAP)).toBe(false);
    }
    // Claimed lots are not offered twice in one session.
    expect(pickLots(m, 0, 20).some((i) => lots.includes(i))).toBe(false);
    const ops = zoneOps(lots, 'homes');
    let tiles = 0;
    for (const o of ops) tiles += (o as Op & { op: 'zone' }).rect[2];
    expect(tiles).toBe(lots.length);
  });

  it('finds a legal site for every Hamlet building, and the move API agrees', () => {
    const { c, now } = founded(['balanced']);
    const t = c.towns[0];
    for (const id of ['well', 'windmill', 'schoolHouse', 'villageGreen', 'pocketPark']) {
      const m = mapOf(t);
      const s = findSite(m, id, { kind: 'edge' });
      expect(s, id).not.toBeNull();
      const def = BUILDINGS[buildingIndex(id)];
      const [w, h] = footprint(def.w, def.h, s!.rot);
      for (let y = s!.y; y < s!.y + h; y++) for (let x = s!.x; x < s!.x + w; x++) expect(isLattice(x, y)).toBe(false);
      const r = applyCommand(c, 's0', { type: 'build', planId: `p-${id}`, plan: [{ op: 'place', id, x: s!.x, y: s!.y, rot: s!.rot }] }, now + 1000);
      expect(r.ok).toBe(true);
    }
  });

  it('counts zones and utility demand from the tiles', () => {
    const { c } = founded(['balanced']);
    const m = mapOf(c.towns[0]);
    const z = zoneCounts(m);
    expect(z.zoned[0]).toBe(12); // Bramble's twelve Homes lots
    expect(z.zoned[5]).toBe(2); // and two Farms
    const u = utilityBalance(m, viewOf(c, 's0', 0)!.params);
    expect(u.waterSupply).toBe(300); // one Well
    expect(u.powerSupply).toBe(0);
    expect(u.powerNeed).toBeGreaterThan(0);
    // Planning ahead counts each lot at its next level, so it never asks for less than what stands.
    expect(utilityBalance(m, viewOf(c, 's0', 0)!.params, false).powerNeed).toBeLessThanOrEqual(u.powerNeed);
  });
});

describe('the bot mayors', () => {
  it('registers the twelve of §11.2 and the Spammer, with the task names as aliases', () => {
    expect(BOT_IDS.length).toBe(13);
    for (const id of BOT_IDS) expect(BOTS[id].id).toBe(id);
    expect(botById('idle').id).toBe('absent');
    expect(botById('greedy-tax').id).toBe('greedy');
    expect(botById('borrower').id).toBe('debt');
    expect(() => botById('nobody')).toThrow();
    expect(BOTS.kid.profile).toBe('kid');
    expect(BOTS.absent.sessions.hours).toEqual([]);
    expect(BOTS.weekly.sessions.sundaysOnly).toBe(true);
  });

  it("follows Bramble's three steps at founding: a lane, 12 Homes, 2 Farms and a Well", () => {
    const c = newCounty(9);
    const now = nextRegionalDayAt(c) + 3_600_000;
    catchUp(c, now, Infinity);
    applyCommand(c, 's0', { type: 'found', site: 0, nameParts: ['Oak', 'vale'], avatar: 'badger', flag: 0 }, now);
    const cmds = brambleCommands(viewOf(c, 's0', now)!);
    expect(cmds.map((x) => x.type)).toEqual(['build', 'build', 'build']);
    const ops = cmds.flatMap((x) => (x.type === 'build' ? x.plan : []));
    expect(ops.filter((o) => o.op === 'road').length).toBeGreaterThan(0);
    const homes = ops.filter((o) => o.op === 'zone' && o.zone === 'homes').reduce((s, o) => s + (o as Op & { op: 'zone' }).rect[2], 0);
    expect(homes).toBe(12);
    expect(ops.filter((o) => o.op === 'place' && o.id === 'well').length).toBe(1);
    const r = apply(c, 's0', cmds, now);
    expect(r.refused).toEqual([]);
  });

  it('every bot plays a legal session on a fresh town, and reading the view changes nothing', () => {
    const bots = BOT_IDS.slice(0, 6);
    const { c, now } = founded([...bots]);
    for (let i = 0; i < bots.length; i++) {
      const before = hashOf(c);
      const view = viewOf(c, `s${i}`, now)!;
      const cmds = BOTS[bots[i]].policy(view, rngOf(i + 1));
      expect(hashOf(c), `${bots[i]} mutated the county while thinking`).toBe(before);
      const r = apply(c, `s${i}`, cmds, now + i * 100_000);
      expect(r.errors, bots[i]).toEqual([]);
      // Bots price their plans like the move API: none is refused for its cost or shape.
      expect(r.refused.filter((x) => /costs|not on the map|in the way|does not fit|straight/.test(x)), bots[i]).toEqual([]);
    }
  });

  it('the rest of the registry plays legally too (Poacher, Hermit, Cooperator, Kid, Weekly, Absent)', () => {
    const bots = BOT_IDS.slice(6, 12);
    const { c, now } = founded([...bots], 4);
    for (let i = 0; i < bots.length; i++) {
      const cmds = BOTS[bots[i]].policy(viewOf(c, `s${i}`, now)!, rngOf(i + 7));
      if (bots[i] === 'absent') expect(cmds).toEqual([]);
      if (bots[i] === 'kid') expect(cmds.filter((x) => x.type !== 'undo').length).toBeLessThanOrEqual(3);
      const r = apply(c, `s${i}`, cmds, now + i * 100_000);
      expect(r.errors, bots[i]).toEqual([]);
      // Until WP3 lands, the county moves a bot tries are refused politely, never accepted.
      for (const x of r.refused.filter((y) => y.startsWith('link') || y.startsWith('advert'))) expect(x).toMatch(/isn.t ready yet/);
    }
  });

  it('is deterministic: the same view and rng give the same moves', () => {
    const a = founded(['balanced', 'kid'], 6);
    const b = founded(['balanced', 'kid'], 6);
    for (const [i, id] of [[0, 'balanced'], [1, 'kid']] as const) {
      const x = BOTS[id].policy(viewOf(a.c, `s${i}`, a.now)!, rngOf(42));
      const y = BOTS[id].policy(viewOf(b.c, `s${i}`, b.now)!, rngOf(42));
      expect(JSON.stringify(x)).toBe(JSON.stringify(y));
    }
  });

  it('the Greedy Taxer sets a high tax and Low funding; the Debt Spender sets a low one', () => {
    const { c, now } = founded(['greedy', 'debt']);
    const g = BOTS.greedy.policy(viewOf(c, 's0', now)!, rngOf(1));
    const tax = g.find((x) => x.type === 'budget' && x.taxes) as Command & { type: 'budget' };
    expect(tax.taxes!.town).toBeGreaterThanOrEqual(1400);
    expect(g.some((x) => x.type === 'budget' && x.funding && Object.values(x.funding).every((f) => f === 0))).toBe(true);
    const d = BOTS.debt.policy(viewOf(c, 's1', now)!, rngOf(1));
    const dt = d.find((x) => x.type === 'budget' && x.taxes) as Command & { type: 'budget' };
    expect(dt.taxes!.town).toBeLessThanOrEqual(800);
  });

  it('the Spammer zones far more Homes than Balanced in the same session', () => {
    const { c, now } = founded(['balanced', 'spammer']);
    const homes = (cmds: Command[]) => cmds.flatMap((x) => (x.type === 'build' ? x.plan : [])).filter((o) => o.op === 'zone' && o.zone === 'homes').reduce((s, o) => s + (o as Op & { op: 'zone' }).rect[2], 0);
    const b = homes(BOTS.balanced.policy(viewOf(c, 's0', now)!, rngOf(1)));
    const s = homes(BOTS.spammer.policy(viewOf(c, 's1', now)!, rngOf(1)));
    expect(s).toBeGreaterThan(b);
    expect(s).toBeGreaterThanOrEqual(20);
  });

});
