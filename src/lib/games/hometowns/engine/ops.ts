// Town-level moves (spec §10.6, §9.3): the atomic build plan (roads, zones,
// buildings, bulldozing, upgrades, parcels), undo, the budget dials and
// `seen`. These touch only one town's own state, so the page and the bots
// run exactly the same code to predict them, and a move stamped with a future
// atTick can wait in `pending` and apply at the start of that tick (A19).
// commands.ts wraps them with the county-level rules (idempotency, catch-up,
// the Regional Day guard, the log).

import { BUILDINGS, ZONE_DEFS, buildingIndex, roadDef } from './content';
import { postWhole } from './core';
import { formatPounds } from './num';
import type { Params } from './params';
import { appendTileEvent, commitRecords, forgetRecords } from './records';
import { T_FOREST, T_GRASS, T_HILL, TF_COAST, TF_RIVER, T_WATER, buildable, terrainElevation, terrainKind, terrainOf } from './terrain';
import {
  B_KIND,
  B_X,
  B_Y,
  CAT_BUILDING,
  CAT_RAIL,
  CAT_ROAD,
  CAT_ZONE,
  MAP,
  RAIL_USE,
  TILES,
  USE_EMPTY,
  buildingUse,
  footprint,
  inMap,
  lvlLevel,
  newBuilding,
  openableParcels,
  pairGet,
  pairSet,
  parcelOpen,
  planesForWrite,
  planesOf,
  roadUse,
  tileIndex,
  useCat,
  usePayload,
  zoneUse,
} from './tiles';
import {
  EngineError,
  FUNDING_GROUPS,
  FUNDING_KEYS,
  ROAD_KINDS,
  TIER_NAMES,
  ZONES,
  type BuildingRecord,
  type CommandResult,
  type FundingPatch,
  type Op,
  type Rect,
  type TaxPatch,
  type TownState,
  type UndoEntry,
} from './types';

export interface OpsEnv {
  params: Params;
  /** Today's Regional Day index (undo and same-day refunds). */
  dayIndex: number;
  profile: 'kid' | 'adult';
}

/** A tile's `use` with building references replaced by one marker, for undo checks. */
const BUILDING_MARK = 0xffff;
const normUse = (u: number) => (useCat(u) === CAT_BUILDING ? BUILDING_MARK : u);

const tierName = (tier: number) => TIER_NAMES[tier][0].toUpperCase() + TIER_NAMES[tier].slice(1);

// ---- Shared helpers ---------------------------------------------------------------------

/** Rewrites every building tile from the building list (after any add or remove). */
export function reindexBuildings(t: TownState): void {
  const p = planesForWrite(t);
  for (let i = 0; i < TILES; i++) if (useCat(p.use[i]) === CAT_BUILDING) p.use[i] = USE_EMPTY;
  t.buildings.forEach((b, i) => {
    const def = BUILDINGS[b[B_KIND]];
    const [w, h] = footprint(def.w, def.h, b[3]);
    for (let y = b[B_Y]; y < b[B_Y] + h; y++) for (let x = b[B_X]; x < b[B_X] + w; x++) p.use[tileIndex(x, y)] = buildingUse(i);
  });
}

function sameBuilding(a: BuildingRecord, b: BuildingRecord): boolean {
  return a[B_KIND] === b[B_KIND] && a[B_X] === b[B_X] && a[B_Y] === b[B_Y];
}

/** £ to build one catalogue item on this site (Forest −10%, River water facilities −40%). */
export function placeCost(t: TownState, kind: number, p: Params): number {
  const def = BUILDINGS[kind];
  let c = def.build;
  if (t.siteKind === 'forest') c *= p.build.forestBuildMult;
  if (t.siteKind === 'river' && def.group === 'water') c *= p.build.riverWaterMult;
  return Math.round(c);
}

function roadTileCost(t: TownState, build: number, tile: number, p: Params): number {
  if (t.siteKind !== 'hills') return build;
  const v = terrainOf(t)[tile];
  return terrainKind(v) === T_HILL || terrainElevation(v) >= 2 ? Math.round(build * p.build.hillRoadMult) : build;
}

function rectTiles(r: Rect): number[] {
  const [x0, y0, w, h] = r;
  if (![x0, y0, w, h].every(Number.isInteger) || w < 1 || h < 1 || w > MAP || h > MAP) throw new EngineError(400, 'That area is not on the map.');
  const out: number[] = [];
  for (let y = Math.max(0, y0); y < Math.min(MAP, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(MAP, x0 + w); x++) out.push(tileIndex(x, y));
  return out;
}

/** The tiles along a path of straight segments (an L is two). */
export function pathTiles(path: number[]): number[] {
  if (!Array.isArray(path) || path.length < 2 || path.length % 2 || path.length > 40 || !path.every(Number.isInteger)) throw new EngineError(400, 'That road path is not straight.');
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (x: number, y: number) => {
    if (!inMap(x, y)) throw new EngineError(400, 'That road runs off the map.');
    const i = tileIndex(x, y);
    if (!seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  };
  push(path[0], path[1]);
  for (let k = 2; k < path.length; k += 2) {
    const [ax, ay, bx, by] = [path[k - 2], path[k - 1], path[k], path[k + 1]];
    if (ax !== bx && ay !== by) throw new EngineError(400, 'Roads go in straight lines: draw an L as two.');
    const dx = Math.sign(bx - ax);
    const dy = Math.sign(by - ay);
    let x = ax;
    let y = ay;
    while (x !== bx || y !== by) {
      x += dx;
      y += dy;
      push(x, y);
    }
  }
  return out;
}

// ---- The atomic build plan ----------------------------------------------------------------------

interface PlanState {
  t: TownState;
  env: OpsEnv;
  cost: number;
  survey: number;
  refund: number;
  /** tile → [use, lvl, age] before this plan. */
  before: Map<number, [number, number, number]>;
  constructionBefore: Map<number, number>;
  added: BuildingRecord[];
  removed: BuildingRecord[];
  /** Today's undo entries (for same-day bulldoze refunds). */
  today: UndoEntry[];
}

function touch(s: PlanState, tile: number): void {
  if (s.before.has(tile)) return;
  const p = planesOf(s.t);
  s.before.set(tile, [p.use[tile], p.lvl[tile], p.age[tile]]);
}

function touchConstruction(s: PlanState, tile: number): void {
  if (!s.constructionBefore.has(tile)) s.constructionBefore.set(tile, pairGet(s.t.construction, tile));
}

function setTile(s: PlanState, tile: number, use: number, lvl = 0, age = 0): void {
  touch(s, tile);
  const p = planesForWrite(s.t);
  p.use[tile] = use;
  p.lvl[tile] = lvl;
  p.age[tile] = age;
}

/** Can this tile take something new (empty, or an empty zoned lot with nothing under way)? */
function freeTile(t: TownState, tile: number): boolean {
  const u = planesOf(t).use[tile];
  if (u === USE_EMPTY) return true;
  return useCat(u) === CAT_ZONE && lvlLevel(planesOf(t).lvl[tile]) === 0 && pairGet(t.construction, tile) === 0;
}

function landOk(t: TownState, tile: number): boolean {
  const x = tile % MAP;
  const y = (tile - x) / MAP;
  return parcelOpen(t, x, y) && buildable(terrainOf(t)[tile]);
}

function clearForest(t: TownState, tile: number): void {
  if (terrainKind(terrainOf(t)[tile]) === T_FOREST) t.terrainEdits.push(tile, T_GRASS);
}

function builtToday(s: PlanState, test: (e: UndoEntry) => boolean): boolean {
  return s.today.some(test);
}

function opRoad(s: PlanState, kind: Op & { op: 'road' }): void {
  const { t, env } = s;
  const def = roadDef(kind.kind);
  if (!def || kind.kind === ('county' as string)) throw new EngineError(400, 'That is not a road you can build.');
  if (t.tier < def.unlock) throw new EngineError(409, `${cap(kind.kind)}s unlock at ${tierName(def.unlock)}.`);
  const rail = kind.kind === 'rail';
  const want = rail ? RAIL_USE : roadUse(ROAD_KINDS.indexOf(kind.kind as (typeof ROAD_KINDS)[number]));
  for (const tile of pathTiles(kind.path)) {
    const u = planesOf(t).use[tile];
    if (rail ? useCat(u) === CAT_RAIL : useCat(u) === CAT_ROAD) continue; // auto-join: existing track or road is kept
    if (!landOk(t, tile)) throw new EngineError(409, 'Part of that road is on locked land or water.');
    if (!freeTile(t, tile)) throw new EngineError(409, rail && useCat(u) === CAT_ROAD ? 'Rail cannot cross a road yet.' : 'Something is in the way: bulldoze it first.');
    clearForest(t, tile);
    setTile(s, tile, want);
    appendTileEvent(t, t.tick, tile, 'road', rail ? 4 : ROAD_KINDS.indexOf(kind.kind as (typeof ROAD_KINDS)[number]));
    s.cost += roadTileCost(t, def.build, tile, env.params);
  }
}

function opUpgrade(s: PlanState, o: Op & { op: 'upgrade' }): void {
  const { t, env } = s;
  if (o.kind === 'rail') throw new EngineError(400, 'Rail is built, not upgraded.');
  const def = roadDef(o.kind);
  if (t.tier < def.unlock) throw new EngineError(409, `${cap(o.kind)}s unlock at ${tierName(def.unlock)}.`);
  const target = ROAD_KINDS.indexOf(o.kind);
  for (const tile of pathTiles(o.path)) {
    const u = planesOf(t).use[tile];
    if (useCat(u) !== CAT_ROAD) continue;
    const from = usePayload(u);
    if (from >= target || ROAD_KINDS[from] === 'county') continue;
    setTile(s, tile, roadUse(target));
    s.cost += roadTileCost(t, Math.max(0, def.build - roadDef(ROAD_KINDS[from]).build), tile, env.params);
  }
}

function opZone(s: PlanState, o: Op & { op: 'zone' }): void {
  const { t, env } = s;
  const z = ZONES.indexOf(o.zone);
  if (z < 0) throw new EngineError(400, 'That is not a zone.');
  const def = ZONE_DEFS[z];
  if (t.tier < def.unlock) throw new EngineError(409, `${cap(o.zone)} zones unlock at ${tierName(def.unlock)}.`);
  if (t.tier > def.zoneUntil) throw new EngineError(409, `New ${o.zone} zones stop at ${tierName(def.zoneUntil)}.`);
  for (const tile of rectTiles(o.rect)) {
    if (!landOk(t, tile) || !freeTile(t, tile)) continue;
    if (planesOf(t).use[tile] === zoneUse(z)) continue;
    setTile(s, tile, zoneUse(z));
    appendTileEvent(t, t.tick, tile, 'zoned', z);
    s.cost += env.params.build.zonePerTile;
  }
}

function opDezone(s: PlanState, o: Op & { op: 'dezone' }): void {
  const { t } = s;
  for (const tile of rectTiles(o.rect)) {
    const u = planesOf(t).use[tile];
    if (useCat(u) !== CAT_ZONE || !freeTile(t, tile)) continue;
    setTile(s, tile, USE_EMPTY);
    appendTileEvent(t, t.tick, tile, 'dezoned', usePayload(u));
  }
}

function placementOk(t: TownState, req: string | undefined, tiles: number[]): boolean {
  if (!req) return true;
  const terr = terrainOf(t);
  const ring = (f: (v: number) => boolean) =>
    tiles.some((tile) => {
      const x = tile % MAP;
      const y = (tile - x) / MAP;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inMap(x + dx, y + dy) && f(terr[tileIndex(x + dx, y + dy)])) return true;
      return false;
    });
  if (req === 'coast') return t.siteKind === 'coast' && ring((v) => (v & TF_COAST) !== 0 && terrainKind(v) === T_WATER);
  if (req === 'water') return ring((v) => terrainKind(v) === T_WATER);
  if (req === 'river') return tiles.some((tile) => (terr[tile] & TF_RIVER) !== 0);
  if (req === 'scenic') return ring((v) => (v & (TF_COAST | TF_RIVER)) !== 0 || terrainKind(v) === T_HILL || terrainElevation(v) === 3);
  return false;
}

/** Groups Helper Mode still allows (§5.13: roads, repairs, utilities and safety). */
const ESSENTIAL = new Set(['power', 'water', 'police', 'fire', 'health', 'civic']);

function opPlace(s: PlanState, o: Op & { op: 'place' }): void {
  const { t, env } = s;
  const kind = buildingIndex(o.id);
  if (kind < 0) throw new EngineError(400, 'That is not something you can build.');
  const def = BUILDINGS[kind];
  if (def.free) throw new EngineError(409, `The ${def.name} comes free with your town.`);
  if (t.tier < def.tier) throw new EngineError(409, `The ${def.name} unlocks at ${tierName(def.tier)}.`);
  if (def.unique && t.buildings.some((b) => b[B_KIND] === kind)) throw new EngineError(409, `Your town already has its ${def.name}.`);
  if (o.id === 'coalPlant' && t.policies.some((p) => p.card === 'greenEnergyPledge')) throw new EngineError(409, 'Your Green Energy Pledge rules out coal.');
  if (t.money.helper && !ESSENTIAL.has(def.group)) throw new EngineError(409, 'Bramble has paused new builds until the budget recovers.');
  if (o.rot !== 0 && o.rot !== 1) throw new EngineError(400, 'That rotation is not allowed.');
  const [w, h] = footprint(def.w, def.h, o.rot);
  const tiles: number[] = [];
  for (let y = o.y; y < o.y + h; y++)
    for (let x = o.x; x < o.x + w; x++) {
      if (!inMap(x, y)) throw new EngineError(409, `The ${def.name} does not fit there.`);
      tiles.push(tileIndex(x, y));
    }
  for (const tile of tiles) if (!landOk(t, tile) || !freeTile(t, tile)) throw new EngineError(409, `The ${def.name} does not fit there.`);
  if (!placementOk(t, def.requires, tiles)) throw new EngineError(409, `The ${def.name} needs ${def.requires === 'scenic' ? 'a view' : def.requires === 'coast' ? 'the sea' : 'water'} beside it.`);
  for (const tile of tiles) {
    clearForest(t, tile);
    touch(s, tile);
  }
  const b = newBuilding(kind, o.x, o.y, o.rot, t.tick, t.funding[FUNDING_KEYS.indexOf(def.funding)] ?? 1);
  t.buildings.push(b);
  s.added.push([...b]);
  reindexBuildings(t);
  const anchor = tileIndex(o.x, o.y);
  touchConstruction(s, anchor);
  const area = w * h;
  const ticks = env.params.build.civicTicks[area <= 1 ? 0 : area <= 4 ? 1 : area <= 9 ? 2 : 3];
  pairSet(t.construction, anchor, ticks);
  appendTileEvent(t, t.tick, anchor, 'placed', kind & 255);
  s.cost += placeCost(t, kind, env.params);
}

function opBulldoze(s: PlanState, o: Op & { op: 'bulldoze' }): void {
  const { t, env } = s;
  const share = env.params.build.sameDayRefund;
  const doomed: number[] = [];
  for (const tile of rectTiles(o.rect)) {
    const u = planesOf(t).use[tile];
    const cat = useCat(u);
    if (cat === CAT_ROAD || cat === CAT_RAIL) {
      if (cat === CAT_ROAD && ROAD_KINDS[usePayload(u)] === 'county') continue; // the County Road stays
      const def = cat === CAT_RAIL ? roadDef('rail') : roadDef(ROAD_KINDS[usePayload(u)]);
      if (builtToday(s, (e) => hasAfter(e, tile, u))) s.refund += Math.round(def.build * share);
      setTile(s, tile, USE_EMPTY);
      appendTileEvent(t, t.tick, tile, 'bulldozed', cat);
    } else if (cat === CAT_ZONE) {
      const lvl = planesOf(t).lvl[tile];
      if (lvlLevel(lvl) === 0 && pairGet(t.construction, tile) === 0) continue;
      // A private building becomes empty zoned land, with no refund (§9.3).
      setTile(s, tile, u, 0, 0);
      touchConstruction(s, tile);
      pairSet(t.construction, tile, 0);
      appendTileEvent(t, t.tick, tile, 'bulldozed', cat);
    } else if (cat === CAT_BUILDING) {
      const i = usePayload(u);
      if (BUILDINGS[t.buildings[i][B_KIND]].free) continue; // the Town Hall stays
      if (!doomed.includes(i)) doomed.push(i);
    }
  }
  doomed.sort((a, b) => b - a);
  for (const i of doomed) {
    const b = t.buildings[i];
    const def = BUILDINGS[b[B_KIND]];
    const [w, h] = footprint(def.w, def.h, b[3]);
    for (let y = b[B_Y]; y < b[B_Y] + h; y++) for (let x = b[B_X]; x < b[B_X] + w; x++) touch(s, tileIndex(x, y));
    const anchor = tileIndex(b[B_X], b[B_Y]);
    touchConstruction(s, anchor);
    pairSet(t.construction, anchor, 0);
    if (builtToday(s, (e) => e.added.some((a) => sameBuilding(a, b)))) s.refund += Math.round(placeCost(t, b[B_KIND], env.params) * share);
    const fresh = s.added.findIndex((a) => sameBuilding(a, b));
    if (fresh >= 0) s.added.splice(fresh, 1);
    else s.removed.push([...b]);
    t.buildings.splice(i, 1);
    appendTileEvent(t, t.tick, anchor, 'bulldozed', CAT_BUILDING);
  }
  if (doomed.length) reindexBuildings(t);
}

function hasAfter(e: UndoEntry, tile: number, use: number): boolean {
  for (let i = 0; i + 5 < e.tiles.length; i += 6) if (e.tiles[i] === tile && e.tiles[i + 4] === use) return true;
  return false;
}

function opParcel(s: PlanState, o: Op & { op: 'parcel' }): void {
  const { t, env } = s;
  if (t.parcelRights < 1) throw new EngineError(409, 'You have no new land to open yet: it comes with your next promotion.');
  if (!openableParcels(t.parcels).includes(o.p)) throw new EngineError(409, 'Open land next to your town first.');
  t.parcels |= 1 << o.p;
  t.parcelRights -= 1;
  s.survey += env.params.build.surveyFee * Math.max(1, t.tier); // £5,000 × the tier number (§3.1)
  appendTileEvent(t, t.tick, tileIndex((o.p % 4) * 16, Math.floor(o.p / 4) * 16), 'parcel', o.p);
}

function cap(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * Applies a whole plan atomically: every op is validated and applied in
 * order, and any refusal (or an unaffordable total) rolls the town back to
 * exactly how it was. Records one undo entry.
 */
export function applyBuild(t: TownState, planId: string, plan: Op[], env: OpsEnv): CommandResult {
  if (!Array.isArray(plan) || plan.length === 0) throw new EngineError(400, 'That plan is empty.');
  if (plan.length > env.params.build.maxOps) throw new EngineError(400, `A plan can hold at most ${env.params.build.maxOps} steps.`);
  commitRecords(t);
  const saved = {
    planes: (() => {
      const p = planesOf(t);
      return { use: p.use.slice(), lvl: p.lvl.slice(), age: p.age.slice() };
    })(),
    buildings: t.buildings.map((b) => [...b]),
    construction: [...t.construction],
    terrainEdits: [...t.terrainEdits],
    parcels: t.parcels,
    parcelRights: t.parcelRights,
    tileLog: t.tileLog,
  };
  const s: PlanState = {
    t, env, cost: 0, survey: 0, refund: 0, before: new Map(), constructionBefore: new Map(), added: [], removed: [],
    today: t.undo.filter((e) => e.day === env.dayIndex),
  };
  try {
    for (const op of plan) {
      switch (op?.op) {
        case 'road': opRoad(s, op); break;
        case 'upgrade': opUpgrade(s, op); break;
        case 'zone': opZone(s, op); break;
        case 'dezone': opDezone(s, op); break;
        case 'place': opPlace(s, op); break;
        case 'bulldoze': opBulldoze(s, op); break;
        case 'parcel': opParcel(s, op); break;
        default: throw new EngineError(400, 'That plan has a step this game does not know.');
      }
    }
    const total = s.cost + s.survey;
    if (total > Math.max(0, t.money.reserves) && total > 0)
      throw new EngineError(409, `That plan costs ${formatPounds(total)} and you have ${formatPounds(Math.max(0, t.money.reserves))}.`);
  } catch (e) {
    const p = planesForWrite(t);
    p.use.set(saved.planes.use);
    p.lvl.set(saved.planes.lvl);
    p.age.set(saved.planes.age);
    t.buildings = saved.buildings;
    t.construction = saved.construction;
    t.terrainEdits = saved.terrainEdits;
    t.parcels = saved.parcels;
    t.parcelRights = saved.parcelRights;
    t.tileLog = saved.tileLog;
    forgetRecords(t);
    throw e;
  }
  postWhole(t, 'capital', -s.cost);
  postWhole(t, 'surveyFees', -s.survey);
  postWhole(t, 'refunds', s.refund);
  // The undo entry: tiles in tile order so its JSON is canonical.
  const tiles: number[] = [];
  const p = planesOf(t);
  for (const tile of [...s.before.keys()].sort((a, b) => a - b)) {
    const [bu, bl, ba] = s.before.get(tile)!;
    tiles.push(tile, normUse(bu), bl, ba, normUse(p.use[tile]), p.lvl[tile]);
  }
  const construction: number[] = [];
  for (const tile of [...s.constructionBefore.keys()].sort((a, b) => a - b)) construction.push(tile, s.constructionBefore.get(tile)!);
  t.undo.push({
    planId, day: env.dayIndex, atTick: t.tick, cost: s.cost + s.survey - s.refund, tiles, added: s.added, removed: s.removed,
    construction, terrainEdits: t.terrainEdits.slice(saved.terrainEdits.length), parcelsBefore: saved.parcels, rightsBefore: saved.parcelRights,
  });
  while (t.undo.length > env.params.build.undoMax) t.undo.shift();
  return { ok: true, atTick: t.tick, cost: s.cost + s.survey - s.refund };
}

/** Undo: a full refund before the Regional Day while the plan's tiles are unchanged (§9.3). */
export function applyUndo(t: TownState, planId: string, env: OpsEnv): CommandResult {
  const at = t.undo.findIndex((e) => e.planId === planId);
  if (at < 0) throw new EngineError(404, 'That plan is no longer in today’s builds.');
  const e = t.undo[at];
  if (e.day !== env.dayIndex) throw new EngineError(409, 'Plans can only be undone on the day they were built.');
  const p = planesOf(t);
  for (let i = 0; i + 5 < e.tiles.length; i += 6) {
    const tile = e.tiles[i];
    if (normUse(p.use[tile]) !== e.tiles[i + 4] || p.lvl[tile] !== e.tiles[i + 5]) throw new EngineError(409, 'Something has changed there since, so that plan cannot be undone.');
  }
  for (const a of e.added) if (!t.buildings.some((b) => sameBuilding(a, b))) throw new EngineError(409, 'Something has changed there since, so that plan cannot be undone.');
  t.buildings = t.buildings.filter((b) => !e.added.some((a) => sameBuilding(a, b)));
  for (const r of e.removed) t.buildings.push([...r]);
  const w = planesForWrite(t);
  for (let i = 0; i + 5 < e.tiles.length; i += 6) {
    const tile = e.tiles[i];
    w.use[tile] = e.tiles[i + 1] === BUILDING_MARK ? USE_EMPTY : e.tiles[i + 1];
    w.lvl[tile] = e.tiles[i + 2];
    w.age[tile] = e.tiles[i + 3];
  }
  reindexBuildings(t);
  for (let i = 0; i + 1 < e.construction.length; i += 2) pairSet(t.construction, e.construction[i], e.construction[i + 1]);
  t.parcels = e.parcelsBefore;
  t.parcelRights = e.rightsBefore;
  // Replant the forest this plan cleared: drop its edit pairs (the latest matching ones).
  for (let i = e.terrainEdits.length - 2; i >= 0; i -= 2) {
    for (let j = t.terrainEdits.length - 2; j >= 0; j -= 2)
      if (t.terrainEdits[j] === e.terrainEdits[i] && t.terrainEdits[j + 1] === e.terrainEdits[i + 1]) {
        t.terrainEdits.splice(j, 2);
        break;
      }
  }
  postWhole(t, 'refunds', e.cost);
  t.undo.splice(at, 1);
  return { ok: true, atTick: t.tick, cost: -e.cost };
}

// ---- The budget dials (§5.13, §7) ----------------------------------------------------------------

export function applyBudget(t: TownState, taxes: TaxPatch | undefined, funding: FundingPatch | undefined, env: OpsEnv): CommandResult {
  const f = env.params.finance;
  const step = env.profile === 'kid' ? f.kidStep : f.adultStep;
  const next = { ...t.taxes, homes: [...t.taxes.homes] };
  const check = (v: unknown, range: readonly number[], what: string): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < range[0] || v > range[1]) throw new EngineError(400, `${what} must be between ${range[0] / 100}% and ${range[1] / 100}%.`);
    if (v % step !== 0) throw new EngineError(400, `${what} moves in steps of ${step / 100}%.`);
    return v;
  };
  const gate = (tier: number, what: string) => {
    if (t.tier < tier) throw new EngineError(409, `${what} unlocks at ${tierName(tier)}.`);
  };
  if (taxes) {
    if (taxes.town !== undefined) {
      const v = check(taxes.town, f.ranges.homes, 'Town Tax');
      next.town = v;
      next.homes = [v, v, v];
      next.business = Math.min(f.ranges.business[1], Math.round(v / 2));
    }
    if (taxes.homes !== undefined) {
      gate(1, 'A separate homes tax');
      if (Array.isArray(taxes.homes)) {
        gate(2, 'Homes tax by tier');
        if (taxes.homes.length !== 3) throw new EngineError(400, 'Homes tax needs one rate per tier.');
        next.homes = taxes.homes.map((v) => check(v, f.ranges.homes, 'Homes tax'));
      } else {
        const v = check(taxes.homes, f.ranges.homes, 'Homes tax');
        next.homes = [v, v, v];
      }
    }
    if (taxes.business !== undefined) {
      gate(1, 'Business tax');
      next.business = check(taxes.business, f.ranges.business, 'Business tax');
    }
    if (taxes.sales !== undefined) {
      gate(2, 'Sales tax');
      next.sales = check(taxes.sales, f.ranges.sales, 'Sales tax');
    }
    if (taxes.hotel !== undefined) {
      gate(3, 'Hotel tax');
      next.hotel = check(taxes.hotel, f.ranges.hotel, 'Hotel tax');
    }
    const h = t.money.helper;
    if (h) {
      // Helper Mode floors (§5.13 step 3, A16 escalation at day 6).
      const homesMin = h.step >= 2 ? 1200 : 1000;
      const bizMin = h.step >= 2 ? 600 : 500;
      if (next.homes.some((v) => v < homesMin) || next.business < bizMin) throw new EngineError(409, 'Bramble is keeping taxes up until the budget recovers.');
    }
  }
  const fund = [...t.funding];
  if (funding) {
    for (const key of Object.keys(funding).sort() as (keyof FundingPatch)[]) {
      const v = funding[key];
      if (v !== 0 && v !== 1 && v !== 2) throw new EngineError(400, 'Funding is Low, Normal or High.');
      const group = (FUNDING_GROUPS as Record<string, readonly string[]>)[key as string];
      const keys = group ?? [key as string];
      if (!group) gate(1, 'Funding each service separately');
      for (const k of keys) {
        const i = FUNDING_KEYS.indexOf(k as (typeof FUNDING_KEYS)[number]);
        if (i < 0) throw new EngineError(400, 'That is not a service.');
        if (t.money.helper && (k === 'fun' || k === 'culture') && v > 0) throw new EngineError(409, 'Bramble is keeping Fun and Culture on Low until the budget recovers.');
        fund[i] = v;
      }
    }
  }
  t.taxes = next;
  t.funding = fund;
  return { ok: true, atTick: t.tick, cost: 0 };
}
