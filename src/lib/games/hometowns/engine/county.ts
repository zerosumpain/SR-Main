// The county driver (spec §10.3, §10.5, §8.3): creating a county, founding a
// town, the Regional Day and lazy catch-up in bounded work units.
//
// Catch-up steps towns in seat order up to min(now, next Regional Day); the
// Regional Day runs once every town has reached it. Because a town's day
// depends only on its own state, its owner's moves, the frozen snapshot and
// the clock, it makes no difference how the work is chunked or in what order
// towns are stepped: one call with a huge budget and a thousand calls with a
// budget of 1 produce the same county, byte for byte.

import {
  countyMonth,
  effectiveNow,
  gridTickAt,
  isCountyWeek,
  nextRegionalDayAt,
  townTarget,
} from './clock';
import { BUILDINGS, buildingIndex, NAME_FIRST, NAME_SECOND, ORDER_DEFAULTS } from './content';
import { commitTown, emptyBooks, emptyRealised, neutralFlows } from './core';
import { paramsFor, type Params, type ParamsVersion } from './params';
import { scenicOf } from './landvalue';
import { terrainNature } from './services';
import { STREAMS, h32 } from './rand';
import { snapshotOf } from './snapshot';
import { STEPS } from './steps';
import {
  COUNTY_ROAD_END_Y,
  COUNTY_ROAD_X,
  TOWN_HALL_AT,
  generateTerrain,
  siteKindsFor,
} from './terrain';
import {
  CELLS,
  CENTRAL_PARCELS,
  DISTRICTS,
  MAP,
  buildingUse,
  emptyPlanes,
  encodeCells,
  encodePlanes,
  newBuilding,
  roadUse,
  tileIndex,
} from './tiles';
import { COST_MONTH, COST_REGIONAL_DAY, COST_TICK, COST_YEAR_END, advanceTown, autoSprintDue, catchUpTown, makeContext, sprintTick, tickCost } from './tick';
import {
  COHORT_COUNT,
  EngineError,
  FUNDING_KEYS,
  PEOPLE_COUNT,
  ROAD_KINDS,
  STAR_COUNT,
  type CatchUpResult,
  type CountySettings,
  type CountyState,
  type FoundBody,
  type RegionalContext,
  type RegionalDayReport,
  type SeatId,
  type StepTable,
  type TownState,
} from './types';

export interface CreateCountyInput {
  seed: number;
  params: ParamsVersion;
  settings: CountySettings;
  epoch: number;
  now: number;
  name?: string;
  regionalHour?: number;
  /** Local dev clock only (§2.6): the adapter passes it only under HOMETOWNS_DEV_CLOCK=1. */
  devTickMs?: number | null;
}

export function createCounty(i: CreateCountyInput): CountyState {
  const p = paramsFor(i.params);
  const seed = i.seed >>> 0;
  const kinds = siteKindsFor(seed);
  const tickMs = i.devTickMs ?? p.clock.tickMs;
  const c: CountyState = {
    name: i.name ?? 'Kingsport County',
    seed,
    paramsVersion: i.params,
    tz: 'Europe/London',
    regionalHour: i.regionalHour ?? p.clock.regionalHour,
    devTickMs: i.devTickMs ?? null,
    epoch: i.epoch,
    tickMs,
    pausedMs: 0,
    pause: null,
    pauseUsedMs: 0,
    nap: null,
    lastHelloAt: i.now,
    gridTick: 0,
    dayIndex: 0,
    lastRegionalDayAt: 0,
    resumedAt: 0,
    season: { n: 1, theme: 'founders', startedDay: 0, startMonth: 0, menu: [] },
    settings: i.settings,
    parents: [],
    sites: kinds.map((kind, index) => ({ index, kind, terrainSeed: h32(seed, STREAMS.terrain, 7, index, 0), owner: null })),
    towns: [],
    kingsport: { pop: p.start.kingsportPop, stars: new Array<number>(STAR_COUNT).fill(p.kingsport.stars), treasuryOut: 0 },
    snapshot: null as never,
    ledger: [],
    links: [],
    offers: [],
    contracts: [],
    pacts: [],
    market: { goods: { p: p.start.price, supply: 0, demand: 0 }, food: { p: p.start.price, supply: 0, demand: 0 } },
    allocations: [],
    flows: { towns: [] },
    greatWork: null,
    goals: { week: 0, goals: [] },
    council: { question: null, options: [], votes: [], closesDay: null, results: [] },
    awards: { week: 0, history: [], dry: [] },
    fund: 0,
    festival: null,
    gazette: [],
    bulletin: [],
    friendship: new Array<number>(36).fill(0),
    log: [],
    alerts: [],
  };
  c.gridTick = gridTickAt(c, i.now);
  c.season.startMonth = countyMonth(c.gridTick);
  c.snapshot = snapshotOf(c, 0, countyMonth(c.gridTick));
  c.snapshot.dayIndex = -1;
  return c;
}

export function townIndexOf(c: CountyState, seat: SeatId): number {
  return c.towns.findIndex((t) => t.seat === seat);
}

/**
 * A11: the founding land-value plane, LV* of each cell from terrain alone
 * (no buildings): the §5.7 formula's base, its nature term (terrain trees and
 * water, as services.ts counts them) and its scenic term (landvalue.ts), with
 * every other term at zero and Premium neutral. Computed by the same
 * functions and params as the month step's LV*, so the two can never disagree.
 */
export function terrainLandValue(terrain: Uint8Array, p: Params = paramsFor('v1')): Uint8Array {
  const out = new Uint8Array(CELLS);
  const f = p.fields;
  const nature = terrainNature(terrain, f.natureTree, f.natureWater, f.natureReach).nature;
  const scenic = scenicOf(terrain, p.landValue.scenic);
  const wn = p.landValue.weights[1];
  for (let c = 0; c < CELLS; c++) {
    const lv = f.lvBase + wn * Math.min(100, nature[c]) + scenic[c];
    out[c] = Math.max(1, Math.min(250, Math.round(lv)));
  }
  return out;
}

const TOWN_HALL = buildingIndex('townHall');

/**
 * Validates a founding without changing anything, and returns the town's
 * name. applyCommand calls it before the founding's implied hello, so a
 * refused founding leaves the county exactly as it was.
 */
export function checkFound(c: CountyState, seat: SeatId, body: FoundBody): string {
  if (c.towns.some((t) => t.seat === seat)) throw new EngineError(409, 'You already have a town.');
  if (c.towns.length >= 6) throw new EngineError(409, 'Kingsport County is full.');
  const site = c.sites[body.site];
  if (!site || !Number.isInteger(body.site)) throw new EngineError(400, 'Pick one of the sites around Kingsport.');
  if (site.owner !== null) throw new EngineError(409, 'Someone has already built on that site.');
  let name: string;
  if (body.nameParts) {
    const [a, b] = body.nameParts;
    if (!(NAME_FIRST as readonly string[]).includes(a) || !(NAME_SECOND as readonly string[]).includes(b)) throw new EngineError(400, 'Pick both halves of the name from the lists.');
    name = a + b;
  } else if (typeof body.name === 'string' && body.nameAllowed) {
    name = body.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 24) throw new EngineError(400, 'A town name is 2 to 24 letters.');
  } else throw new EngineError(400, 'Choose a name for your town.');
  if (typeof body.avatar !== 'string' || body.avatar.length > 32) throw new EngineError(400, 'Pick a mayor.');
  return name;
}

/** §10.3 foundTown: a seat's one town on a free site, with its County Road and Town Hall. */
export function foundTown(c: CountyState, seat: SeatId, body: FoundBody, now: number): TownState {
  if (!Number.isFinite(now)) throw new EngineError(400, 'The clock is not ready yet.');
  const p = paramsFor(c.paramsVersion);
  const name = checkFound(c, seat, body);
  const site = c.sites[body.site];
  const index = c.towns.length;
  const profile = c.settings.perSeat[seat]?.profile ?? 'adult';
  const terrain = generateTerrain(site.terrainSeed, site.kind);

  // The County Road from the Kingsport signpost, and the free Town Hall beside its end.
  const planes = emptyPlanes();
  const county = roadUse(ROAD_KINDS.indexOf('county'));
  for (let y = COUNTY_ROAD_END_Y; y < MAP; y++) planes.use[tileIndex(COUNTY_ROAD_X, y)] = county;
  const [hx, hy] = TOWN_HALL_AT;
  const hall = BUILDINGS[TOWN_HALL];
  for (let y = hy; y < hy + hall.h; y++) for (let x = hx; x < hx + hall.w; x++) planes.use[tileIndex(x, y)] = buildingUse(0);

  const s = p.start;
  const t: TownState = {
    seat,
    ownerId: body.ownerId ?? seat,
    name,
    avatar: body.avatar,
    flag: Number.isInteger(body.flag) ? body.flag : 0,
    site: body.site,
    siteKind: site.kind,
    terrainSeed: site.terrainSeed,
    seed: h32(c.seed, STREAMS.seed, body.site, index, 0),
    foundedAt: now,
    foundGrid: gridTickAt(c, now),
    gridBase: null,
    tick: 0,
    sprintLeft: p.clock.sprintTicks,
    sprintAt: 0,
    sprintAuto: false,
    archived: false,
    tier: 0,
    tierHold: 0,
    parcels: CENTRAL_PARCELS,
    parcelRights: 0,
    planes: encodePlanes(planes),
    planesRev: 0,
    terrainEdits: [],
    construction: [],
    marks: [],
    lv: encodeCells(terrainLandValue(terrain, p)),
    buildings: [newBuilding(TOWN_HALL, hx, hy, 0, 0, 1)],
    lag: { poll: encodeCells(new Uint8Array(CELLS)), congestion: new Array<number>(DISTRICTS).fill(1000) },
    pending: [],
    moveIds: [],
    people: new Array<number>(PEOPLE_COUNT).fill(0),
    applicants: new Array<number>(COHORT_COUNT).fill(0),
    aspirants: [0, 0],
    squeezed: 0,
    longUnemployed: [0, 0, 0],
    carry: {},
    meters: [...s.meters],
    margins: new Array<number>(10).fill(s.margin),
    perceived: new Array<number>(STAR_COUNT).fill(50),
    happy: new Array<number>(COHORT_COUNT).fill(s.happy),
    approval: s.approval,
    culture: s.culture,
    edu: s.edu,
    rep: s.rep,
    aw: s.aw,
    ps: s.ps,
    goodsStock: [0, 0],
    money: { reserves: s.reserves, loan: null, bonds: [], rating: s.rating, ratingHold: 0, overdraftMonths: 0, helper: null, lastHelperDay: null, lastWriteOffDay: null, fundAdvance: 0 },
    taxes: {
      town: p.finance.defaults.town,
      homes: [p.finance.defaults.homes, p.finance.defaults.homes, p.finance.defaults.homes],
      business: p.finance.defaults.business,
      sales: p.finance.defaults.sales,
      hotel: p.finance.defaults.hotel,
    },
    funding: new Array<number>(FUNDING_KEYS.length).fill(1),
    policies: [],
    orders: ORDER_DEFAULTS.map((o) => ({ kind: o.kind, on: profile === 'kid' ? o.kid : o.adult, args: [...o.args] })),
    initiatives: 1,
    away: { lastHelloAt: now, weekStartPop: 0, weekLoss: 0 },
    holiday: { until: null, usedDays: 0 },
    grace: c.dayIndex + p.migration.graceDays,
    shield: null,
    improvement: [],
    history: '',
    why: '',
    tileLog: '',
    undo: [],
    inbox: [],
    stamps: [],
    trophies: [],
    residents: [],
    lastSeenTick: 0,
    books: emptyBooks(s.reserves, 0),
    realised: emptyRealised(c.dayIndex, c.allocations.length, c.contracts.length),
    dev: '',
    alerts: [],
  };
  site.owner = seat;
  c.towns.push(t);
  // County-level arrays sized by town count (WP3 owns their contents).
  const n = c.towns.length;
  const ledger = new Array<number>(n * n * COHORT_COUNT).fill(0);
  for (let a = 0; a < n - 1; a++) for (let b = 0; b < n - 1; b++) for (let k = 0; k < COHORT_COUNT; k++) ledger[(a * n + b) * COHORT_COUNT + k] = c.ledger[(a * (n - 1) + b) * COHORT_COUNT + k] ?? 0;
  c.ledger = ledger;
  c.flows.towns.push(neutralFlows());
  c.bulletin.push([]);
  c.council.votes.push(null);
  c.awards.dry.push(0);
  if (!c.settings.youngestOrder.includes(seat)) c.settings.youngestOrder.push(seat);
  return t;
}

// ---- The Regional Day ----------------------------------------------------------------------------

export interface DriveOptions {
  steps?: StepTable;
  /** Town indices someone is streaming: a chunk that advances one reports changed (A27). */
  streaming?: readonly number[];
}

/**
 * §8.3. Idempotent by dayIndex (A28): a call for any other index is a no-op.
 * Step 0 runs unfinished sprints (A23) and catches every town up to the
 * instant; then the step table's steps 1–10 run in order. A step that throws
 * is recorded as an alert and the day carries on.
 */
export function regionalDay(c: CountyState, dayIndex: number, opts: DriveOptions = {}): RegionalDayReport {
  const p = paramsFor(c.paramsVersion);
  const at = nextRegionalDayAt(c, p.clock.devRegionalTicks);
  const report: RegionalDayReport = { dayIndex, at, ran: false, sprintsRun: 0, countyWeek: false, steps: [] };
  if (dayIndex !== c.dayIndex) return report;
  const steps = opts.steps ?? STEPS;
  report.ran = true;
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    while (!t.archived && t.gridBase === null && t.sprintLeft > 0) {
      sprintTick(c, i, at, steps);
      report.sprintsRun++;
    }
  }
  const g = gridTickAt(c, at);
  for (let i = 0; i < c.towns.length; i++) catchUpTown(c, i, g, steps);
  if (g > c.gridTick) c.gridTick = g;
  report.countyWeek = isCountyWeek(c, at, dayIndex);
  const r: RegionalContext = { params: p, dayIndex, at, month: countyMonth(g), countyWeek: report.countyWeek, report };
  for (const s of steps.regional) {
    try {
      s.run(c, r);
      report.steps.push(s.id);
    } catch (e) {
      c.alerts.push({ at, town: null, kind: 'regional-day', message: `${s.id}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 400) });
      while (c.alerts.length > 20) c.alerts.shift();
    }
  }
  c.dayIndex = dayIndex + 1;
  c.lastRegionalDayAt = at;
  for (const t of c.towns) commitTown(t);
  return report;
}

// ---- Catch-up ---------------------------------------------------------------------------------------

/** The work units of the sprint ticks a Regional Day will run for unfinished fortnights (A23). */
function sprintBacklogCost(c: CountyState): number {
  let units = 0;
  for (const t of c.towns) {
    if (t.archived || t.gridBase !== null) continue;
    for (let k = 0; k < t.sprintLeft; k++) units += COST_TICK + ((t.tick + k) % 4 === 3 ? COST_MONTH : 0);
  }
  return units;
}

/**
 * §10.5 catchUp: advances the county toward `now` in at most `budget` work
 * units (tick 1, month step +COST_MONTH, Regional Day 20 + 8 per town plus
 * the sprint ticks it finishes). Always makes progress: the first unit of
 * work runs even if it alone exceeds the budget. A27: `changed` is false for
 * an intermediate chunk unless it ran a Regional Day or advanced a town
 * someone is streaming.
 */
export function catchUp(c: CountyState, now: number, budget: number, opts: DriveOptions = {}): CatchUpResult {
  if (!Number.isFinite(now)) return { used: 0, done: true, changed: false };
  const p = paramsFor(c.paramsVersion);
  const steps = opts.steps ?? STEPS;
  const eff = effectiveNow(c, now, p.clock.napAfterMs);
  let used = 0;
  let ranDay = false;
  let streamed = false;
  const over = (cost: number) => used > 0 && used + cost > budget;
  // Every exit writes the towns' stored strings back (ticks leave the planes' encoding to here).
  const commitAll = () => {
    for (const t of c.towns) commitTown(t);
  };
  const partial = (): CatchUpResult => {
    commitAll();
    return { used, done: false, changed: streamed || ranDay };
  };
  for (;;) {
    const R = nextRegionalDayAt(c, p.clock.devRegionalTicks);
    const limit = Math.min(eff, R);
    // "Play it all": automatic sprint ticks every sprintAutoMs, up to the limit.
    for (let i = 0; i < c.towns.length; i++) {
      const t = c.towns[i];
      while (autoSprintDue(t, limit, p.clock.sprintAutoMs)) {
        const cost = tickCost(t);
        if (over(cost)) return partial();
        sprintTick(c, i, t.sprintAt + p.clock.sprintAutoMs, steps);
        used += cost;
        if (opts.streaming?.includes(i)) streamed = true;
      }
    }
    const g = gridTickAt(c, limit);
    for (let i = 0; i < c.towns.length; i++) {
      const t = c.towns[i];
      while (t.tick < townTarget(t, g)) {
        const cost = tickCost(t);
        if (over(cost)) return partial();
        advanceTown(t, makeContext(c, i, t.tick), steps);
        used += cost;
        if (opts.streaming?.includes(i)) streamed = true;
      }
    }
    if (g > c.gridTick) c.gridTick = g;
    if (R > eff) break;
    const cost = COST_REGIONAL_DAY + COST_YEAR_END * c.towns.length + sprintBacklogCost(c);
    if (over(cost)) return partial();
    regionalDay(c, c.dayIndex, opts);
    used += cost;
    ranDay = true;
  }
  commitAll();
  return { used, done: true, changed: ranDay || used > 0 || streamed };
}

/** The number of grid ticks a town still owes at `now` (0 when caught up). */
export function behind(c: CountyState, i: number, now: number): number {
  const p = paramsFor(c.paramsVersion);
  const eff = effectiveNow(c, now, p.clock.napAfterMs);
  const g = gridTickAt(c, Math.min(eff, nextRegionalDayAt(c, p.clock.devRegionalTicks)));
  return townTarget(c.towns[i], g) - c.towns[i].tick;
}

