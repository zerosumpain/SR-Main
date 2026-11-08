// Scripted upstream for WP2b's tests and scenario runs (spec §13.1: packages
// code against the contracts, not against each other). The people model reads
// the supply count (WP2e's M1b) and services (WP2a's M3); until those land,
// and in scenario tests that need a town to stay exactly as scripted, these
// stand-ins write the same blackboard slots from the tiles or from fixed
// numbers. Nothing here is part of the engine.

import { ZONE_DEFS, tileMix } from '../../src/lib/games/hometowns/engine/content';
import { neutral, newDerivedCache } from '../../src/lib/games/hometowns/engine/derived';
import { makeContext, tickTown } from '../../src/lib/games/hometowns/engine/tick';
import { MonthWhy } from '../../src/lib/games/hometowns/engine/why';
import { paramsFor } from '../../src/lib/games/hometowns/engine/params';
import { withSteps } from '../../src/lib/games/hometowns/engine/steps';
import * as stubs from '../../src/lib/games/hometowns/engine/stubs';
import { CAT_ZONE, TILES, constructionLeft, lvlLevel, lvlTier, planesOf, useCat, usePayload } from '../../src/lib/games/hometowns/engine/tiles';
import {
  SECTOR_COUNT,
  ZONE_SECTOR,
  Z_HOMES,
  type CountyState,
  type CoverageSlot,
  type DerivedCache,
  type DevelopmentSlot,
  type FieldsSlot,
  type MonthContext,
  type MonthStep,
  type StepTable,
  type TownState,
} from '../../src/lib/games/hometowns/engine/types';

/** The development slot as WP2e defines it (§5.8 capacity, A2 skill mix), counted straight from the tiles. */
export function supplyFromPlanes(t: TownState): DevelopmentSlot {
  const s = neutral.development();
  const p = planesOf(t);
  const l2 = paramsFor('v1').labour.entryMixL2;
  for (let i = 0; i < TILES; i++) {
    if (useCat(p.use[i]) !== CAT_ZONE) continue;
    const z = usePayload(p.use[i]);
    const level = lvlLevel(p.lvl[i]);
    s.zoned[z] += 1;
    if (level === 0) continue;
    const size = ZONE_DEFS[z].capacity[level - 1] ?? 0;
    const busy = constructionLeft(t, i) > 0;
    if (!busy) s.built[z] += 1;
    if (z === Z_HOMES) {
      const h = Math.min(2, lvlTier(p.lvl[i]));
      if (busy) s.pipeline[h] += size;
      else s.cap[h] += size;
      continue;
    }
    const sector = ZONE_SECTOR[z];
    const mix = tileMix(sector, level, l2);
    for (let h = 0; h < 3; h++) (busy ? s.pipeJobs : s.jobs)[sector * 3 + h] += size * mix[h];
  }
  return s;
}

export interface Scripted {
  /** Extra supply on top of the tiles (or instead of them with `tiles: false`). */
  cap?: number[];
  pipeline?: number[];
  /** Jobs by [sector·3 + h]. */
  jobs?: number[];
  tiles?: boolean;
  reachableHomes?: boolean[];
  coverage?: Partial<CoverageSlot>;
  fields?: Partial<FieldsSlot>;
}

/**
 * A step table with WP2e's supply and WP2a's services replaced by scripted
 * values and every other package's step held at its stub, so a WP2b test
 * measures WP2b alone, whatever the other packages have landed meanwhile.
 * `live: true` keeps the other packages' real steps instead.
 */
export function scriptedSteps(s: Scripted | ((t: TownState, m: MonthContext) => Scripted), live = false): StepTable {
  const get = (t: TownState, m: MonthContext) => (typeof s === 'function' ? s(t, m) : s);
  const supply: MonthStep = (t, m) => {
    const sc = get(t, m);
    const d = sc.tiles === false ? neutral.development() : supplyFromPlanes(t);
    for (let h = 0; h < 3; h++) {
      d.cap[h] += sc.cap?.[h] ?? 0;
      d.pipeline[h] += sc.pipeline?.[h] ?? 0;
    }
    for (let k = 0; k < SECTOR_COUNT * 3; k++) d.jobs[k] += sc.jobs?.[k] ?? 0;
    if (sc.reachableHomes) d.reachableHomes = [...sc.reachableHomes];
    m.derived.development = d;
  };
  const fields: MonthStep = (t, m) => {
    const sc = get(t, m);
    m.derived.fields = { ...neutral.fields(t), ...(sc.fields ?? {}) };
    m.derived.coverage = { ...neutral.coverage(t), ...(sc.coverage ?? {}) };
  };
  const held = live
    ? {}
    : {
        develop: stubs.stubDevelop,
        'M2 utilities': stubs.stubUtilities,
        'M4 transport': stubs.stubTransport,
        'M6 tourism': stubs.stubTourism,
        'M7b spending': stubs.stubSpending,
        'M7c tax receipts': stubs.stubTaxReceipts,
        'M8 firms': stubs.stubFirms,
        'M13 finance': stubs.stubFinance,
        'M10b happiness': stubs.stubHappiness,
        'M14 records': stubs.stubRecords,
      };
  return withSteps({ ...held, 'M1b supply': supply, 'M3 fields': fields });
}

/**
 * A month context for town i at its current tick, with the given slots
 * already on the blackboard (unit tests of one step). The World event is
 * cleared so a Baby Boom drawn for the fixture's month cannot move a fixture.
 */
export function monthContext(c: CountyState, i: number, over: Partial<DerivedCache> = {}): MonthContext & { why: MonthWhy } {
  const ctx = makeContext(c, i, c.towns[i].tick);
  const why = new MonthWhy();
  return { ...ctx, world: { ...ctx.world, event: null }, month: ctx.world.month, derived: { ...newDerivedCache(), ...over }, why };
}

/**
 * Runs `months` whole months (4 ticks each) of town i with `steps`, and
 * returns each month's blackboard as M14 left it, so a test can read the
 * slots that are otherwise thrown away.
 */
export function runMonths(c: CountyState, i: number, months: number, steps: StepTable, each?: (month: number, d: DerivedCache) => void): DerivedCache[] {
  const out: DerivedCache[] = [];
  const last = steps.month[steps.month.length - 1];
  const table: StepTable = {
    ...steps,
    month: steps.month.map((r) => (r === last ? { ...r, run: (t: TownState, m: MonthContext) => (r.run(t, m), out.push(m.derived)) } : r)),
  };
  const t = c.towns[i];
  for (let k = 0; k < months; k++) {
    // Align to a month boundary first.
    do tickTown(t, makeContext(c, i, t.tick), table);
    while (t.tick % 4 !== 0);
    each?.(k, out[out.length - 1]);
  }
  return out;
}
