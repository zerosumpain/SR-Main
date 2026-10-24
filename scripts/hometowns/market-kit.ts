// Scripted upstream for WP2c's tests and scenario runs (spec §13.1: packages
// code against the contracts, not against each other). The market reads the
// supply count (WP2e), labour (WP2b) and the fields (WP2a); these stand-ins
// write the same blackboard slots from the tiles or from fixed numbers, so a
// market test measures the market alone. `hotelDeveloper` is WP2e's §5.2
// rules for Leisure tiles in miniature (visit a quarter of the tiles a tick,
// grow, level up and decline by the logistic chances, hotels where beds are
// short), so long runs can show what the market does when supply answers its
// meter. Nothing here is part of the engine.

import { BUILDINGS, ZONE_DEFS, buildingIndex, tileMix } from '../../src/lib/games/hometowns/engine/content';
import { reindexBuildings } from '../../src/lib/games/hometowns/engine/ops';
import { fixture } from './fixture';
import { buildable, terrainOf } from '../../src/lib/games/hometowns/engine/terrain';
import { neutral } from '../../src/lib/games/hometowns/engine/derived';
import { sigma } from '../../src/lib/games/hometowns/engine/fx';
import { paramsFor } from '../../src/lib/games/hometowns/engine/params';
import { withSteps } from '../../src/lib/games/hometowns/engine/steps';
import { S_LEISURE } from '../../src/lib/games/hometowns/engine/trade';
import * as stubs from '../../src/lib/games/hometowns/engine/stubs';
import {
  CAT_ZONE,
  MAP,
  TILES,
  USE_EMPTY,
  VARIANT_HOTEL,
  constructionLeft,
  lvlLevel,
  lvlStyle,
  lvlTier,
  makeLvl,
  newBuilding,
  pairSet,
  parcelOpen,
  planesForWrite,
  planesOf,
  tileIndex,
  useCat,
  usePayload,
} from '../../src/lib/games/hometowns/engine/tiles';
import {
  PERSON_S,
  SECTOR_COUNT,
  STAGE_P,
  STAGE_R,
  STAGE_W,
  ZONE_SECTOR,
  Z_HOMES,
  Z_LEISURE,
  METER_LEISURE,
  person,
  type CountyState,
  type CoverageSlot,
  type DevelopmentSlot,
  type FieldsSlot,
  type LabourSlot,
  type MonthStep,
  type StepTable,
  type TickStep,
  type TownState,
} from '../../src/lib/games/hometowns/engine/types';

const P = paramsFor('v1');

/** The development slot counted from the tiles (WP2e's definition, A2 mix), with hotel beds. */
export function marketSupply(t: TownState): DevelopmentSlot {
  const s = neutral.development();
  const p = planesOf(t);
  const l2 = P.labour.entryMixL2;
  const beds = ZONE_DEFS[Z_LEISURE].beds ?? [];
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
    if (z === Z_LEISURE && lvlTier(p.lvl[i]) === VARIANT_HOTEL && !busy) s.beds += beds[level - 1] ?? 0;
    const sector = ZONE_SECTOR[z];
    const mix = tileMix(sector, level, l2);
    for (let h = 0; h < 3; h++) (busy ? s.pipeJobs : s.jobs)[sector * 3 + h] += size * mix[h];
  }
  return s;
}

export interface LabourScript {
  /** Productivity (wages are W0 × prod). */
  prod?: number;
  /** Share of every sector's slots filled, or 'people' to match the town's workforce tier by tier. */
  fill?: number | 'people';
  /** Extra unemployed £ workers (for the bootstrap's labour gate). */
  unemployed?: number;
}

/** A labour slot from the people and the supply: own-tier matching only, wages at W0 × prod. */
export function scriptedLabour(t: TownState, dev: DevelopmentSlot, s: LabourScript = {}): LabourSlot {
  const l = neutral.labour();
  const prod = s.prod ?? 1;
  const people = t.people;
  const wf = [0, 0, 0];
  for (let h = 0; h < 3; h++) wf[h] = Math.round(0.85 * people[person(STAGE_W, h)] + 0.72 * people[person(STAGE_P, h)]);
  wf[0] += Math.round(0.4 * people[PERSON_S]);
  const slots = [0, 0, 0];
  for (let k = 0; k < SECTOR_COUNT; k++) for (let h = 0; h < 3; h++) slots[h] += dev.jobs[k * 3 + h];
  const tierFill = [0, 0, 0];
  for (let h = 0; h < 3; h++) tierFill[h] = s.fill === 'people' || s.fill === undefined ? (slots[h] > 0 ? Math.min(1, wf[h] / slots[h]) : 0) : s.fill;
  l.wage = P.labour.W0.map((w) => w * prod);
  l.prod = prod;
  l.workforce = wf;
  l.jobSlots = slots;
  for (let h = 0; h < 3; h++) {
    l.employed[h] = Math.min(wf[h], Math.round(slots[h] * tierFill[h]));
    l.unemployed[h] = wf[h] - l.employed[h];
    l.vacancies[h] = slots[h] - l.employed[h];
  }
  l.unemployed[0] += s.unemployed ?? 0;
  l.sectorEffective = [];
  l.sectorWages = [];
  for (let k = 0; k < SECTOR_COUNT; k++) {
    let jobs = 0;
    let filled = 0;
    let bill = 0;
    for (let h = 0; h < 3; h++) {
      const j = dev.jobs[k * 3 + h];
      jobs += j;
      filled += j * tierFill[h];
      bill += j * tierFill[h] * l.wage[h];
    }
    l.sectorJobs[k] = jobs;
    l.sectorFilled[k] = filled;
    l.fillRate[k] = jobs > 0 ? filled / jobs : 0;
    l.sectorEffective.push(filled);
    l.sectorWages.push(bill);
  }
  let jobsAll = 0;
  for (const x of slots) jobsAll += x;
  l.effJobs = jobsAll;
  for (let h = 0; h < 3; h++) {
    const pensions = 0.6 * P.labour.W0[0] * people[person(STAGE_R, h)];
    const support = 0.35 * P.labour.W0[0] * l.unemployed[h];
    l.income[h] = l.employed[h] * l.wage[h] + pensions + support + (h === 0 ? 500 * people[PERSON_S] : 0);
  }
  return l;
}

export interface MarketScript {
  labour?: LabourScript | false;
  fields?: Partial<FieldsSlot>;
  coverage?: Partial<CoverageSlot>;
  /** Extra supply on top of the tiles. */
  beds?: number;
  /** Keep WP2b's people steps live (otherwise the population stays as it is). */
  people?: boolean;
}

/**
 * A step table with the supply counted from the tiles, labour scripted (or
 * WP2b's, with `labour: false`), WP2a's fields and services scripted, WP2d
 * and WP2e held at their stubs, and WP2c's real steps.
 */
export function marketSteps(s: MarketScript = {}, extraTick: TickStep[] = []): StepTable {
  const supply: MonthStep = (t, m) => {
    const d = marketSupply(t);
    d.beds += s.beds ?? 0;
    m.derived.development = d;
  };
  const labour: MonthStep = (t, m) => {
    m.derived.labour = scriptedLabour(t, m.derived.development ?? neutral.development(), s.labour || {});
  };
  const fields: MonthStep = (t, m) => {
    m.derived.fields = { ...neutral.fields(t), ...(s.fields ?? {}) };
    m.derived.coverage = { ...neutral.coverage(t), ...(s.coverage ?? {}) };
  };
  const people = s.people
    ? {}
    : {
        'M7a households': stubs.stubHouseholds,
        'M9 demography': stubs.stubDemography,
        'M10 stars': stubs.stubStars,
        'M11 migration': stubs.stubMigration,
        'M12 housing': stubs.stubHousing,
      };
  const table = withSteps({
    develop: stubs.stubDevelop,
    'M1b supply': supply,
    'M2 utilities': stubs.stubUtilities,
    'M3 fields': fields,
    'M4 transport': stubs.stubTransport,
    ...(s.labour === false ? {} : { 'M5 labour': labour }),
    ...people,
    'M7c tax receipts': stubs.stubTaxReceipts,
    'M13 finance': stubs.stubFinance,
    'M10b happiness': stubs.stubHappiness,
    'M14 records': stubs.stubRecords,
  });
  return { ...table, tick: [...table.tick, ...extraTick.map((run, k) => ({ id: `kit ${k}`, owner: 'WP2e' as const, run }))] };
}

/** Sets tile i to Leisure at `level` (hotel variant or not), finished. */
export function setLeisure(t: TownState, i: number, level: number, hotel: boolean): void {
  const p = planesForWrite(t);
  p.use[i] = (CAT_ZONE << 12) | Z_LEISURE;
  p.lvl[i] = makeLvl(level, hotel ? VARIANT_HOTEL : 0, 0);
  p.age[i] = 24;
}

/**
 * WP2e's §5.2 development rules for Leisure tiles only, for long market runs:
 * each tick visits the tiles with perm(i) mod 4 = t mod 4; an empty Leisure
 * tile grows with p = 0.30·σ((D − 10)/15) (as a hotel when the town could
 * sell more stays than it has beds), a built one levels up with
 * p = 0.25·σ((D − 10)/15) and declines with p = 0.10·σ((−D − 40)/12); and a
 * sector whose margin has been below −15% for 3 months closes one hotel level
 * a tick. D is the Leisure meter; desirability counts zero.
 */
export function hotelDeveloper(maxLevel = 5): TickStep {
  return (t, ctx) => {
    const d = ctx.params.develop;
    const D = t.meters[METER_LEISURE];
    const memo = t.marketMemo;
    const bedsShort = memo ? memo.bedDemand > hotelBeds(t) : false;
    const pGrow = d.pGrow * sigma((D - d.zMid) / d.zScale);
    const pDecline = d.pDecline * sigma((-D - d.declineMid) / d.declineScale);
    const closing = memo ? memo.lowMonths[S_LEISURE] >= 3 : false;
    const p = planesOf(t);
    let closed = false;
    for (let i = 0; i < TILES; i++) {
      if (useCat(p.use[i]) !== CAT_ZONE || usePayload(p.use[i]) !== Z_LEISURE) continue;
      if ((((i * d.strideMul + t.seed) >>> 0) % 4096) % 4 !== ctx.tick % 4) continue;
      if (constructionLeft(t, i) > 0) continue;
      const lvl = p.lvl[i];
      const level = lvlLevel(lvl);
      const u = ctx.rng('develop', i, 0) / 4294967296;
      const w = (): ReturnType<typeof planesForWrite> => planesForWrite(t);
      if (level === 0) {
        if (u < pGrow) {
          w().lvl[i] = makeLvl(1, bedsShort ? VARIANT_HOTEL : 0, lvlStyle(lvl));
          pairSet(t.construction, i, d.buildTicks[0]);
        }
      } else if (closing && !closed && lvlTier(lvl) === VARIANT_HOTEL) {
        w().lvl[i] = makeLvl(level - 1, level - 1 > 0 ? VARIANT_HOTEL : 0, lvlStyle(lvl));
        closed = true;
      } else if (u < pDecline) {
        w().lvl[i] = makeLvl(level - 1, level - 1 > 0 ? lvlTier(lvl) : 0, lvlStyle(lvl));
      } else if (level < maxLevel && 1 - u < d.pLevel * sigma((D - d.zMid) / d.zScale)) {
        w().lvl[i] = makeLvl(level + 1, lvlTier(lvl) === VARIANT_HOTEL || bedsShort ? VARIANT_HOTEL : 0, lvlStyle(lvl));
        pairSet(t.construction, i, d.buildTicks[level]);
      }
    }
  };
}

/** Finished hotel beds on the tiles. */
export function hotelBeds(t: TownState): number {
  const p = planesOf(t);
  const beds = ZONE_DEFS[Z_LEISURE].beds ?? [];
  let n = 0;
  for (let i = 0; i < TILES; i++) {
    if (useCat(p.use[i]) !== CAT_ZONE || usePayload(p.use[i]) !== Z_LEISURE || lvlTier(p.lvl[i]) !== VARIANT_HOTEL) continue;
    if (constructionLeft(t, i) > 0) continue;
    const level = lvlLevel(p.lvl[i]);
    if (level > 0) n += beds[level - 1] ?? 0;
  }
  return n;
}


/**
 * Places a finished building of `id` on the first free buildable run of
 * tiles inside the open parcels (scenario set-up only: no cost, no road
 * check). Returns false if none fits.
 */
export function placeFree(t: TownState, id: string): boolean {
  const kind = buildingIndex(id);
  const def = BUILDINGS[kind];
  const terrain = terrainOf(t);
  const p = planesForWrite(t);
  for (let y = 0; y + def.h <= MAP; y++)
    for (let x = 0; x + def.w <= MAP; x++) {
      let ok = true;
      for (let yy = y; yy < y + def.h && ok; yy++)
        for (let xx = x; xx < x + def.w && ok; xx++) {
          const i = tileIndex(xx, yy);
          if (!parcelOpen(t, xx, yy) || !buildable(terrain[i]) || p.use[i] !== USE_EMPTY) ok = false;
        }
      if (!ok) continue;
      t.buildings.push(newBuilding(kind, x, y, 0, t.tick, 1));
      reindexBuildings(t);
      return true;
    }
  return false;
}

/**
 * The seaside scenario: the town fixture (a coast site) with its beach as
 * its only attraction, every Leisure lot empty, known county-wide (awareness
 * 0.9) with the reputation of an uncrowded beach, and its clock moved back
 * `daysBack` days (90: high summer).
 */
export function seasideTown(daysBack = 90): { c: CountyState; i: number; t: TownState } {
  const f = fixture('town');
  const t = f.county.towns[f.town];
  f.county.epoch -= daysBack * 86_400_000;
  t.buildings = t.buildings.filter((b) => !BUILDINGS[b[0]].visitorCap && !BUILDINGS[b[0]].appeal);
  reindexBuildings(t);
  const p = planesOf(t);
  for (let i = 0; i < TILES; i++) if (useCat(p.use[i]) === CAT_ZONE && usePayload(p.use[i]) === Z_LEISURE) setLeisure(t, i, 0, false);
  t.aw = 0.9;
  t.rep = 67;
  return { c: f.county, i: f.town, t };
}
