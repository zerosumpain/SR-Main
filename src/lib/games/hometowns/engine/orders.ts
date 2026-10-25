// The Deputy's standing orders (WP2d, spec §5.18). They run in M13, after
// the books and Helper Mode, so they are as deterministic as the rest of the
// month: same state, same orders, same actions. A child's seat sees them as
// "if … then …" cards and can switch them on and off; an adult can also edit
// the thresholds and reorder them (at most 12: decision 12). Every action Bramble takes is
// written to the inbox as a Deputy card (finance.ts deputyNote), so the
// Welcome-back sheet can say what happened while the mayor was away.
//
// Two orders act elsewhere and only read their switch here:
//   - buyUtilities: WP2a's auto-import (utilities.ts autoImport);
//   - renewContracts: WP3 renews a contract at the Regional Day (renewsContracts).
// fixDamaged is applied by WP2e's tick step (develop.ts repairs); Bramble
// reports the month's repair bill here. Repairs need no decision 11 guard: they
// change no tile and reopen only buildings that still stand (spec §5.18).
//
// Decision 11: no order changes a tile the mayor zoned or built today (the
// mayor's undo entries for the day, MAYOR_TODAY), so a child's own move and
// its undo always survive the Deputy; the Deputy's builds and zoning go on the
// town's Deputy undo list (ops.ts DEPUTY_UNDO_MAX, deputyZoned), never the mayor's.

import { monthF64, monthU8 } from './pool';
import { BUILDINGS, ORDER_DEFAULTS, TIER_DEFS, ZONE_DEFS, buildingIndex, roadDef } from './content';
import { lineIndex, population, postWhole } from './core';
import { civicMemo, deputyNote, levelPayment, monthsOfSpending, monthlySpending, type MonthBooks } from './finance';
import { applyBuild, deputyZoned, mayorTilesToday, placeCost, roadTileCost } from './ops';
import { homeTiles } from './housing';
import { attachOf, roadDistrict, workReach } from './labour';
import { roadNetOf } from './space';
import { appendTileEvent } from './records';
import { CHECKLISTS, GREAT_METROPOLIS, checkFacts, type CheckFacts } from './tiers';
import { T_FOREST, TOWN_HALL_AT, buildable, terrainKind, terrainOf } from './terrain';
import { B_KIND, B_STAFF, B_X, B_Y, CAT_ROAD, CAT_ZONE, MAP, TILES, USE_EMPTY, cellOf, constructionLeft, footprint, inMap, pairPlane, parcelOpen, planesForWrite, planesOf, roadAccess, tileIndex, useCat, usePayload, zoneUse, zonedTiles } from './tiles';
import {
  COVERAGES,
  EngineError,
  FUNDING_KEYS,
  FUND_LOW,
  METER_FARMS,
  METER_INDUSTRY,
  METER_SHOPS,
  Z_FARMS,
  Z_HOMES,
  Z_INDUSTRY,
  Z_SHOPS,
  type Actor,
  type Command,
  type CommandResult,
  type CountyState,
  type CivicMemo,
  type MonthContext,
  type StandingOrder,
  type TownState,
} from './types';
import type { Params } from './params';

/** Most orders a town may keep (§5.18; decision 12: was 8). */
export const MAX_ORDERS = 12;

/** Bounds of each order's adult-editable thresholds (same order as ORDER_DEFAULTS' args). */
const ARG_BOUNDS: Record<string, readonly [number, number][]> = {
  budgetHealthy: [[0.5, 12], [0, 500]],
  awayZoning: [[0, 24], [0, 100], [0, 12]],
  growthHelp: [[0, 48], [0, 12], [0, 20]],
  repayLoan: [[0.5, 24]],
};

/**
 * Decision 11: the tiles the mayor zoned or built today (mayorTilesToday),
 * set while runOrders runs; every Deputy edit skips them. Null when the
 * mayor changed nothing today (an absent mayor's usual month).
 */
let MAYOR_TODAY: Uint8Array | null = null;
const mayors = (i: number): boolean => MAYOR_TODAY !== null && MAYOR_TODAY[i] === 1;

const FUN = FUNDING_KEYS.indexOf('fun');
const CULTURE = FUNDING_KEYS.indexOf('culture');

const orderOn = (t: TownState, kind: string): StandingOrder | null => {
  for (const o of t.orders) if (o.kind === kind) return o.on ? o : null;
  return null;
};

/** Does the Deputy renew this town's own contracts (WP3 asks at the Regional Day)? */
export function renewsContracts(t: TownState): boolean {
  return orderOn(t, 'renewContracts') !== null && orderOn(t, 'hold') === null;
}

// ---- The month (M13) ------------------------------------------------------------------------------------

/** Tiles in order of distance from the Town Hall (ties by index): where the Deputy zones first. */
const BY_DISTANCE: readonly number[] = (() => {
  const [hx, hy] = TOWN_HALL_AT;
  const tiles = Array.from({ length: TILES }, (_, i) => i);
  const d = (i: number) => Math.abs((i % MAP) - hx) + Math.abs(Math.floor(i / MAP) - hy);
  return tiles.sort((a, b) => d(a) - d(b) || a - b);
})();

/** Unit steps east, west, south, north: the fixed order the Deputy tries directions in. */
const DIRS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function nextToRoad(use: Uint16Array, i: number): boolean {
  const x = i % MAP;
  const y = (i - x) / MAP;
  return (
    (x > 0 && useCat(use[i - 1]) === CAT_ROAD) ||
    (x < MAP - 1 && useCat(use[i + 1]) === CAT_ROAD) ||
    (y > 0 && useCat(use[i - MAP]) === CAT_ROAD) ||
    (y < MAP - 1 && useCat(use[i + MAP]) === CAT_ROAD)
  );
}

const isRoad = (use: Uint16Array, x: number, y: number): boolean => inMap(x, y) && useCat(use[tileIndex(x, y)]) === CAT_ROAD;

/**
 * Does tile i continue a road's dead end straight on (decision 8)? The Deputy
 * leaves that tile unzoned, so a later lane (awayRoad) can extend the road
 * instead of finding every road end capped by its own lots.
 */
function continuesDeadEnd(use: Uint16Array, i: number): boolean {
  const x = i % MAP;
  const y = (i - x) / MAP;
  for (const [dx, dy] of DIRS) {
    // r = the road tile behind i; a dead end when its only road neighbour is the one behind it.
    const rx = x - dx;
    const ry = y - dy;
    if (isRoad(use, rx, ry) && isRoad(use, rx - dx, ry - dy) && !isRoad(use, rx + dy, ry + dx) && !isRoad(use, rx - dy, ry - dx)) return true;
  }
  return false;
}

/**
 * Zones up to `n` empty roadside tiles with zone `z` (nearest the Town Hall
 * first; with `first`, the tiles whose attachment road is in a district it
 * marks before all others), leaving the tile beyond each road's dead end free (decision 8);
 * returns tiles zoned. The lots join today's Deputy undo entry `plan` (decision 11).
 */
function zoneRoadside(t: TownState, z: number, n: number, plan: ZonePlan, first: { far: Uint8Array; attach: Int32Array } | null = null): number {
  if (n <= 0) return 0;
  const terrain = terrainOf(t);
  const read = planesOf(t).use;
  const left = pairPlane(t.construction); // constructionLeft for every tile at once
  const picks: number[] = [];
  for (let pass = first ? 0 : 1; pass < 2; pass++)
    for (const i of BY_DISTANCE) {
      if (picks.length >= n) break;
      if (read[i] !== USE_EMPTY || left[i] > 0 || mayors(i)) continue;
      if (first) {
        const d = roadDistrict(first.attach, i);
        if ((pass === 0) !== (d >= 0 && first.far[d] === 1)) continue; // the far districts' lots in the first pass only
      }
      const v = terrain[i];
      if (!buildable(v) || terrainKind(v) === T_FOREST) continue;
      const x = i % MAP;
      if (!parcelOpen(t, x, (i - x) / MAP) || !nextToRoad(read, i) || continuesDeadEnd(read, i)) continue;
      picks.push(i);
    }
  if (picks.length === 0) return 0;
  const w = planesForWrite(t);
  const before: number[] = [];
  for (const i of picks) {
    before.push(i, w.use[i], w.lvl[i], w.age[i]);
    w.use[i] = zoneUse(z);
    w.lvl[i] = 0;
    w.age[i] = 0;
    appendTileEvent(t, t.tick, i, 'zoned', z);
  }
  deputyZoned(t, plan.id, plan.day, before);
  return picks.length;
}

/**
 * Decision 11: the Deputy undo entry a zoning action joins, one per order
 * action a day: `deputy.<day>.zone` (the away order's lots), `deputy.<day>.market`
 * (the market's Shops lots), `deputy.<day>.help.zone.<zone id>` (growth help's
 * work lots) and `deputy.<day>.help.rezone.<zone id>` (Homes lots it repainted).
 */
interface ZonePlan {
  id: string;
  day: number;
}

function zoneAllowed(t: TownState, z: number): boolean {
  const d = ZONE_DEFS[z];
  return t.tier >= d.unlock && t.tier <= d.zoneUntil;
}

// ---- Away civic builds (decision 6, §5.18) ------------------------------------------------------------------

/**
 * Shops lots the Deputy zones for the Village market: the checklist wants 6
 * built Shops tiles, and two spare lots cover a slow builder (the Balanced
 * bot's margin).
 */
export const MARKET_LOTS = 8;

/** Most Village Greens the Deputy places for the green70 item (one at a time). */
export const AWAY_GREENS = 6;

/** The Village checklist items the Deputy may build while the mayor is away, in the order it tries them (checklist order). */
export const AWAY_CIVIC_ITEMS = ['water90', 'market', 'school', 'green70'] as const;

/** Scratch scores for civicSite's anchors (always left all zero). */
const SITE_SCORE = new Int32Array(TILES);

/** Is item `id` of the Village checklist met at the last month end (false before the first one)? */
function villageItemMet(memo: CivicMemo, id: string): boolean {
  const k = CHECKLISTS[1].findIndex((it) => it.id === id);
  return memo.check.tier === 1 && memo.check.items > 0 && k >= 0 && (memo.check.met & (1 << k)) !== 0;
}

/** Catalogue buildings of `group` the town has: finished, and still under construction. */
function groupCount(t: TownState, group: string): { built: number; building: number } {
  let built = 0;
  let building = 0;
  for (const b of t.buildings) {
    if (BUILDINGS[b[B_KIND]]?.group !== group) continue;
    if (constructionLeft(t, tileIndex(b[B_X], b[B_Y])) > 0) building++;
    else built++;
  }
  return { built, building };
}

/**
 * The best spot for a building (rotation 0): every footprint tile empty,
 * buildable, not Forest, on open land and within the road reach a zoned lot
 * needs (develop.roadReach, §3.4); scored by the homes tiles within half its
 * radius plus one (where the services falloff still gives most of its cover),
 * counting only homes whose cell is not yet covered by `cover` when the
 * month's coverage is known. Between equal scores a spot off the road's edge
 * wins, so the roadside lots stay for homes and shops; then the spot nearest
 * the Town Hall. Null when nowhere fits or nothing scores.
 */
function civicSite(t: TownState, m: MonthContext, kind: number, cover: (typeof COVERAGES)[number] | null): [number, number] | null {
  const def = BUILDINGS[kind];
  const [w, h] = footprint(def.w, def.h, 0);
  const terrain = terrainOf(t);
  const p = planesOf(t);
  const field = cover ? m.derived.coverage?.cov[COVERAGES.indexOf(cover)] : undefined;
  const alt = cover === 'nature' ? m.derived.coverage?.cov[COVERAGES.indexOf('fun')] : undefined;
  const at = m.params.civic.coveredAt;
  // Each uncovered home adds 2 to every anchor whose footprint centre is within reach (doubled
  // coordinates keep it in integers); only the anchors scored this way are tried as sites.
  const reach = def.radius / 2 + 1;
  const r4 = 4 * reach * reach;
  const span = Math.ceil(reach) + Math.max(w, h);
  const touched: number[] = [];
  const zoned = zonedTiles(p.use);
  for (let q = 0; q < zoned.length; q++) {
    const j = zoned[q];
    const u = p.use[j];
    if (useCat(u) !== CAT_ZONE || usePayload(u) !== Z_HOMES) continue;
    const c = cellOf(j);
    if (field && Math.max(field[c], alt ? alt[c] : 0) >= at) continue;
    const hx = j % MAP;
    const hy = (j - hx) / MAP;
    for (let y0 = Math.max(0, hy - span); y0 <= Math.min(MAP - 1, hy + span); y0++)
      for (let x0 = Math.max(0, hx - span); x0 <= Math.min(MAP - 1, hx + span); x0++) {
        const dx = 2 * hx - (2 * x0 + w - 1);
        const dy = 2 * hy - (2 * y0 + h - 1);
        if (dx * dx + dy * dy > r4) continue;
        const a = tileIndex(x0, y0);
        if (SITE_SCORE[a] === 0) touched.push(a);
        SITE_SCORE[a] += 2;
      }
  }
  if (touched.length === 0) return null;
  const access = roadAccess(t, m.params.develop.roadReach);
  const left = pairPlane(t.construction); // constructionLeft for every tile at once
  let best: [number, number] | null = null;
  let bestScore = 0;
  for (const i of BY_DISTANCE) {
    let score = SITE_SCORE[i];
    if (score === 0) continue;
    const x0 = i % MAP;
    const y0 = (i - x0) / MAP;
    let ok = true;
    let edge = false;
    for (let y = y0; ok && y < y0 + h; y++)
      for (let x = x0; ok && x < x0 + w; x++) {
        if (!inMap(x, y)) {
          ok = false;
          break;
        }
        const j = tileIndex(x, y);
        const v = terrain[j];
        if (p.use[j] !== USE_EMPTY || mayors(j) || !access[j] || left[j] > 0 || !buildable(v) || terrainKind(v) === T_FOREST || !parcelOpen(t, x, y)) ok = false;
        else if (!edge && nextToRoad(p.use, j)) edge = true;
      }
    if (!ok) continue;
    if (!edge) score++;
    if (score > bestScore) {
      bestScore = score;
      best = [x0, y0];
    }
  }
  for (const a of touched) SITE_SCORE[a] = 0;
  return best;
}

/**
 * G8: where a Well would bring water back to the most homes. Water grids are
 * road components (utilities.ts), so the Well goes on the component whose
 * built homes have the most residents' capacity without water this month,
 * on the first spot (nearest the Town Hall) that is empty open land, not
 * Forest, within the road reach a lot needs and attached to that component;
 * a spot off the road's edge wins, so the roadside lots stay for homes and
 * shops. Null when every home has water, or no spot fits.
 */
function waterSite(t: TownState, m: MonthContext): [number, number] | null {
  const u = m.derived.utilities;
  if (!u) return null;
  const net = roadNetOf(t, m.params.develop.roadReach);
  const p = planesOf(t);
  const caps = ZONE_DEFS[Z_HOMES].capacity;
  const dry = monthF64(net.comps);
  const left = pairPlane(t.construction); // constructionLeft for every tile at once
  const zoned = zonedTiles(p.use);
  for (let q = 0; q < zoned.length; q++) {
    const i = zoned[q];
    const use = p.use[i];
    if (useCat(use) !== CAT_ZONE || usePayload(use) !== Z_HOMES || u.watered[i]) continue;
    const level = p.lvl[i] & 7;
    const a = net.attach[i];
    if (level === 0 || a < 0 || left[i] > 0) continue;
    dry[net.comp[a]] += caps[level - 1] ?? 0;
  }
  let target = -1;
  for (let c = 0; c < net.comps; c++) if (dry[c] > 0 && (target < 0 || dry[c] > dry[target])) target = c;
  if (target < 0) return null;
  const terrain = terrainOf(t);
  const access = roadAccess(t, m.params.develop.roadReach);
  let edge: [number, number] | null = null;
  for (const j of BY_DISTANCE) {
    const a = net.attach[j];
    if (a < 0 || net.comp[a] !== target || p.use[j] !== USE_EMPTY || mayors(j) || !access[j] || left[j] > 0) continue;
    const v = terrain[j];
    const x = j % MAP;
    const y = (j - x) / MAP;
    if (!buildable(v) || terrainKind(v) === T_FOREST || !parcelOpen(t, x, y)) continue;
    if (!nextToRoad(p.use, j)) return [x, y];
    if (!edge) edge = [x, y];
  }
  return edge;
}

/**
 * Decision 6 (John, 2026-10-24): while the mayor is away, the away order also
 * works the Village checklist's civic items: water (a Well on the grid of the
 * homes without it, G8), the market (Shops lots by the roads, free like all
 * zoning), a School House and Village Greens (up to AWAY_GREENS). At most one
 * item a Regional Day, one building at a time, and a building only when its
 * cost leaves reserves above the order's safety floor (args[2] months of
 * spending). Everything goes through the same build plan as a mayor's own move
 * (placement, tier, Helper Mode, an entry on the Deputy's undo list), and each action is a Deputy
 * card for the Welcome-back sheet. Returns the Shops tiles it zoned.
 */
function awayCivic(t: TownState, m: MonthContext, memo: CivicMemo, floor: number, tilesLeft: number): { tiles: number; starved: boolean } {
  const none = { tiles: 0, starved: false };
  if (t.tier !== 0 || memo.civicDay === m.dayIndex) return none;
  // One look a Regional Day, at its first away month (an item, or nothing, until the next day):
  // the site search walks the whole map, and the month step's budget (G12) has no room for it monthly.
  memo.civicDay = m.dayIndex;
  const schools = groupCount(t, 'primary');
  const parks = groupCount(t, 'park');
  const wells = groupCount(t, 'water');
  const underWay = schools.building + parks.building + wells.building > 0; // one building at a time: wait for this one to open
  let starved = false;
  for (const item of AWAY_CIVIC_ITEMS) {
    if (villageItemMet(memo, item)) continue;
    if (item === 'water90') {
      // G8: homes the growing hamlet added past its Well's reach or supply; a Well on their grid restores the item.
      if (underWay || memo.check.items === 0) continue;
      const kind = buildingIndex('well');
      const cost = placeCost(t, kind, m.params);
      if (t.money.reserves - cost <= floor) continue;
      const at = waterSite(t, m);
      if (!at) continue;
      try {
        applyBuild(t, `deputy.${m.dayIndex}.well`, [{ op: 'place', id: 'well', x: at[0], y: at[1], rot: 0 }], { params: m.params, dayIndex: m.dayIndex, profile: 'kid', deputy: true });
      } catch (e) {
        if (e instanceof EngineError) continue;
        throw e;
      }
      deputyNote(t, m, 'awayCivic.build', { building: 'well', item, cost });
      return { tiles: 0, starved };
    }
    if (item === 'market') {
      // Shops lots sit empty until the people can keep the shops going (a negative Shops meter), and
      // they would take the roadside lots new homes need: the market waits for the Shops meter, or for
      // the town to be within 80% of a Village's people (when the Balanced bot holds homes back for it).
      if (!zoneAllowed(t, Z_SHOPS) || (t.meters[METER_SHOPS] <= 0 && population(t) * 5 < TIER_DEFS[1].population * 4)) continue;
      const use = planesOf(t).use;
      const zoned = zonedTiles(use);
      const shop = zoneUse(Z_SHOPS);
      let lots = 0;
      for (let q = 0; q < zoned.length; q++) if (use[zoned[q]] === shop) lots++;
      const want = Math.min(MARKET_LOTS - lots, tilesLeft);
      if (want <= 0) continue; // the lots are down; the builders will fill them
      const n = zoneRoadside(t, Z_SHOPS, want, { id: `deputy.${m.dayIndex}.market`, day: m.dayIndex });
      if (n === 0) {
        starved = true; // no free roadside land for the market (decision 8: Bramble may lay a lane)
        continue;
      }
      deputyNote(t, m, 'awayCivic.market', { shops: n });
      return { tiles: n, starved: n < want };
    }
    const id = item === 'school' ? 'schoolHouse' : 'villageGreen';
    if (underWay || (item === 'school' ? schools.built > 0 : parks.built >= AWAY_GREENS)) continue;
    const kind = buildingIndex(id);
    const cost = placeCost(t, kind, m.params);
    if (t.money.reserves - cost <= floor) continue; // only from the money above the safety floor
    const at = civicSite(t, m, kind, item === 'school' ? 'school' : 'nature');
    if (!at) continue;
    try {
      applyBuild(t, `deputy.${m.dayIndex}.${id}`, [{ op: 'place', id, x: at[0], y: at[1], rot: 0 }], { params: m.params, dayIndex: m.dayIndex, profile: 'kid', deputy: true });
    } catch (e) {
      if (e instanceof EngineError) continue;
      throw e;
    }
    deputyNote(t, m, 'awayCivic.build', { building: id, item, cost });
    return { tiles: 0, starved };
  }
  return { tiles: 0, starved };
}

// ---- Away road extensions (decision 8, §5.18) ---------------------------------------------------------------

/** Longest lane the Deputy lays in one go (tiles). */
export const AWAY_ROAD_TILES = 6;

/**
 * Decision 8 (John, 2026-10-25): when the away order wants to zone (or lay
 * the market) but finds no free roadside land, Bramble lays one short Lane a
 * Regional Day to open new frontage (`perDay` looks: the growth-help order's
 * work lots may take up to GROWTH_LANES, the looks of both orders counted
 * together). It runs straight out from an existing
 * road tile (extending a road's dead end, which the Deputy's zoning leaves
 * free for this, or branching off a road's side), 1 to AWAY_ROAD_TILES tiles,
 * over empty, open, buildable land: water and rock are never buildable, and
 * Forest may be crossed (the road clears it, as a mayor's does) but its tiles
 * never count as new lots, as the Deputy never zones Forest. Flood plain is
 * allowed, as the rules allow roads and homes up to L3 there. A lane is scored
 * by the new roadside lots it opens (empty, open, non-Forest tiles beside it
 * that are not already by a road; not the tile beyond its end, which the
 * Deputy's zoning leaves free as a dead end's continuation); the best score wins,
 * then the lane clearing fewer Forest tiles, then the shorter, then the start
 * nearest the Town Hall (directions east, west, south, north). Its cost must
 * leave reserves above the order's safety floor. It goes through the same
 * build plan as a mayor's road (the Deputy's undo list, tile log), with a Deputy card.
 * Returns whether a lane was laid.
 */
function awayRoad(t: TownState, m: MonthContext, memo: CivicMemo, floor: number, perDay = 1): boolean {
  if (memo.roadDay !== m.dayIndex) {
    memo.roadDay = m.dayIndex;
    memo.roadsToday = 0;
  }
  if ((memo.roadsToday ?? 0) >= perDay) return false;
  memo.roadsToday = (memo.roadsToday ?? 0) + 1; // `perDay` looks a Regional Day, laid or not
  const spare = t.money.reserves - floor;
  if (spare <= 0) return false;
  const terrain = terrainOf(t);
  const use = planesOf(t).use;
  const lane = roadDef('lane').build;
  const left = pairPlane(t.construction); // constructionLeft for every tile at once
  // Where the lane may run: empty, open, buildable land (Forest included: the road clears it, as a mayor's does).
  const open = (i: number): boolean => {
    if (use[i] !== USE_EMPTY || mayors(i) || left[i] > 0 || !buildable(terrain[i])) return false;
    const x = i % MAP;
    return parcelOpen(t, x, (i - x) / MAP);
  };
  // A lot the lane opens: open land the Deputy would zone (not Forest) that is not by a road yet.
  const lot = (i: number): boolean => open(i) && terrainKind(terrain[i]) !== T_FOREST && !nextToRoad(use, i);
  let best: { x0: number; y0: number; x1: number; y1: number; n: number; score: number; trees: number; cost: number } | null = null;
  const seen: number[] = [];
  for (const r of BY_DISTANCE) {
    if (useCat(use[r]) !== CAT_ROAD) continue;
    const rx = r % MAP;
    const ry = (r - rx) / MAP;
    for (const [dx, dy] of DIRS) {
      seen.length = 0;
      let score = 0;
      let trees = 0;
      let cost = 0;
      for (let k = 1; k <= AWAY_ROAD_TILES; k++) {
        const x = rx + dx * k;
        const y = ry + dy * k;
        if (!inMap(x, y)) break;
        const i = tileIndex(x, y);
        if (!open(i)) break;
        if (terrainKind(terrain[i]) === T_FOREST) trees++;
        cost += roadTileCost(t, lane, i, m.params);
        if (cost >= spare) break;
        // New lots: its two sides. Not the tile beyond its end: the lane ends in a dead end, and the
        // Deputy's zoning leaves the tile continuing a dead end free (continuesDeadEnd), so it is never a lot.
        for (const [sx, sy] of [[dy, dx], [-dy, -dx]] as const) {
          const ax = x + sx;
          const ay = y + sy;
          if (!inMap(ax, ay)) continue;
          const a = tileIndex(ax, ay);
          if (seen.includes(a) || !lot(a)) continue;
          seen.push(a);
          score++;
        }
        if (score === 0 || (best && (score < best.score || (score === best.score && (trees > best.trees || (trees === best.trees && k >= best.n)))))) continue;
        best = { x0: rx + dx, y0: ry + dy, x1: x, y1: y, n: k, score, trees, cost };
      }
    }
  }
  if (!best) return false;
  // A planId a lane: growth help may lay up to GROWTH_LANES a day, and the undo of one must not take another.
  const nth = memo.roadsToday! > 1 ? `.${memo.roadsToday}` : '';
  try {
    applyBuild(t, `deputy.${m.dayIndex}.road${nth}`, [{ op: 'road', kind: 'lane', path: [best.x0, best.y0, best.x1, best.y1] }], { params: m.params, dayIndex: m.dayIndex, profile: 'kid', deputy: true });
  } catch (e) {
    if (e instanceof EngineError) return false;
    throw e;
  }
  deputyNote(t, m, 'awayRoad', { tiles: best.n, cost: best.cost }, nth ? nth.slice(1) : undefined); // a card a lane
  return true;
}

// ---- Growth help (G3, §5.18) ----------------------------------------------------------------------------

/**
 * The next tier's coverage items the growth-help order can hold with one
 * small building, and that building: the Town checklist's services, which a
 * growing Village keeps outgrowing (new streets fall outside the old
 * buildings' reach, and new children outnumber the seats).
 */
export const GROWTH_BUILDS: Readonly<Record<string, readonly [id: string, cover: (typeof COVERAGES)[number]]>> = {
  surgery70: ['surgery', 'health'],
  police50: ['constablePost', 'police'],
  fire70: ['fireVolunteers', 'fire'],
  primary80: ['villageSchool', 'school'],
};

/** The zones that give work and their meters (Industry, Shops, Farms: the order a full tie goes). */
const JOB_ZONES: readonly [zone: number, meter: number][] = [
  [Z_INDUSTRY, METER_INDUSTRY],
  [Z_SHOPS, METER_SHOPS],
  [Z_FARMS, METER_FARMS],
];

/** The month's checklist facts made `margin` (a share, 0–1) worse: an item that fails on them is about to lapse. */
function stressed(f: CheckFacts, margin: number): CheckFacts {
  return {
    ...f,
    covered: f.covered.map((x) => x - margin),
    primarySeats: f.primarySeats - margin,
    unemployment: f.unemployment + margin,
  };
}

/** Staff fill (per mille) under which the growth-help order adds no more of a service: a new one would only share the staff. */
export const GROWTH_STAFFED = 800;

/** Lane looks a Regional Day the growth-help order may make for its work lots (the away order: one; G3). */
export const GROWTH_LANES = 3;

/** The jobs item's line (CHECKLISTS: unemployment ≤ 10%). */
const JOBS_LINE = 0.1;

/** The mean staff fill (per mille) of the town's finished `group` buildings (1000 when it has none). */
function staffFill(t: TownState, group: string): number {
  let n = 0;
  let sum = 0;
  for (const b of t.buildings) {
    if (BUILDINGS[b[B_KIND]]?.group !== group || constructionLeft(t, tileIndex(b[B_X], b[B_Y])) > 0) continue;
    n++;
    sum += b[B_STAFF];
  }
  return n > 0 ? sum / n : 1000;
}

/**
 * The districts holding homes with no work within the longest commute
 * (§5.9: their workers count as unemployed however many jobs stand open
 * elsewhere); null when every home can reach work, or before there is any.
 */
function farDistricts(t: TownState, m: MonthContext): { far: Uint8Array; attach: Int32Array } | null {
  const reach = workReach(t, m);
  if (!reach) return null;
  const homes = homeTiles(t, m);
  const attach = attachOf(t, m);
  const far = monthU8(reach.length);
  let any = false;
  for (let k = 0; k < homes.count; k++) {
    const d = roadDistrict(attach, homes.tile[k]);
    if (d < 0) continue; // no road at home: work lots cannot help it
    if (reach[d]) continue;
    far[d] = 1;
    any = true;
  }
  return any ? { far, attach } : null;
}

/** Empty Homes lots the growth-help order always leaves for the builders (a day of a child's zoning). */
export const GROWTH_KEEP_HOMES = 16;

/**
 * Rezones up to `n` empty Homes lots (level 0, nothing under way) as zone
 * `z`, the far districts' first, then nearest the Town Hall, leaving
 * GROWTH_KEEP_HOMES of them; only lots with a road in reach (`attach`, the
 * road net's: a lot builders cannot reach would sit empty as work too);
 * returns tiles rezoned.
 */
function rezoneEmptyHomes(t: TownState, z: number, n: number, plan: ZonePlan, first: { far: Uint8Array; attach: Int32Array } | null, attach: Int32Array): number {
  const spare = emptyLots(t, Z_HOMES) - GROWTH_KEEP_HOMES;
  const most = Math.min(n, spare);
  if (most <= 0) return 0;
  const read = planesOf(t);
  const homes = zoneUse(Z_HOMES);
  const left = pairPlane(t.construction); // constructionLeft for every tile at once
  const picks: number[] = [];
  for (let pass = first ? 0 : 1; pass < 2; pass++)
    for (const i of BY_DISTANCE) {
      if (picks.length >= most) break;
      if (read.use[i] !== homes || read.lvl[i] !== 0 || attach[i] < 0 || mayors(i) || left[i] > 0) continue;
      if (first) {
        const d = roadDistrict(first.attach, i);
        if ((pass === 0) !== (d >= 0 && first.far[d] === 1)) continue;
      }
      picks.push(i);
    }
  if (picks.length === 0) return 0;
  const w = planesForWrite(t);
  const before: number[] = [];
  for (const i of picks) {
    before.push(i, w.use[i], w.lvl[i], w.age[i]);
    w.use[i] = zoneUse(z);
    w.age[i] = 0;
    appendTileEvent(t, t.tick, i, 'zoned', z);
  }
  deputyZoned(t, plan.id, plan.day, before);
  return picks.length;
}

/** Zone `z` lots still waiting for their first building (the builders' queue). */
function emptyLots(t: TownState, z: number): number {
  const p = planesOf(t);
  const zoned = zonedTiles(p.use);
  const lot = zoneUse(z);
  let n = 0;
  for (let q = 0; q < zoned.length; q++) if (p.use[zoned[q]] === lot && p.lvl[zoned[q]] === 0) n++;
  return n;
}

/** Workers without a job and the workforce, from this month's labour slot (the jobs90 fact's parts). */
function unemploymentOf(m: MonthContext): { unemployed: number; workforce: number; rate: number } {
  const lab = m.derived.labour;
  let unemployed = 0;
  let workforce = 0;
  for (let h = 0; h < 3; h++) {
    unemployed += lab?.unemployed[h] ?? 0;
    workforce += lab?.workforce[h] ?? 0;
  }
  return { unemployed, workforce, rate: workforce > 0 ? unemployed / workforce : 0 };
}

/**
 * G3 (§5.18, the growth-help order): a child's town that has reached Village
 * keeps outgrowing the Town checklist's jobs and services, and a child does
 * not read the Growth sheet. Once a Regional Day (its first month), Bramble
 * looks at the next tier's checklist on this month's facts, counting an item
 * that holds by less than `marginPts` points as about to lapse:
 *   - jobs90: growthJobs. The day's later months look again at this item
 *     alone (from the labour slot, no map walk), so a burst of new homes
 *     gets its work lots the same day, within the one daily allowance.
 *   - each coverage item of GROWTH_BUILDS (checklist order): its building, at
 *     the site with the most homes it does not yet reach (as decision 6's
 *     away builds), only when no building of that service is still under
 *     construction, the ones it has are at least GROWTH_STAFFED staffed
 *     (another would only share their staff), and its cost leaves reserves
 *     above the safety floor (`months` of spending); a dearer one that does
 *     not fit waits. So at most one building per item a day: a Village that
 *     outgrows its surgery's, constable's and fire volunteers' reach at once
 *     gets all three that day, not one a day while the others lapse.
 * Everything is a Deputy card; buildings go through the same build plan as
 * a mayor's move.
 */
function growthHelp(t: TownState, m: MonthContext, memo: CivicMemo, tiles: number, floor: number, marginPts: number): void {
  if (t.tier < 1) return;
  const items = CHECKLISTS[Math.min(GREAT_METROPOLIS, t.tier + 1)];
  if (memo.helpDay === m.dayIndex) {
    // The day's later months: the jobs item only.
    if (t.money.reserves > floor && items.some((it) => it.id === 'jobs90') && unemploymentOf(m).rate + marginPts / 100 > JOBS_LINE)
      growthJobs(t, m, memo, Math.floor(tiles), floor);
    return;
  }
  memo.helpDay = m.dayIndex; // one full look a Regional Day (the facts and the site search walk the map: G12)
  memo.helpTiles = 0;
  if (t.money.reserves <= floor) return;
  const f = checkFacts(t, m);
  const risky = stressed(f, marginPts / 100);
  for (const it of items) {
    if (it.ok(risky)) continue;
    if (it.id === 'jobs90') {
      growthJobs(t, m, memo, Math.floor(tiles), floor);
      continue;
    }
    const pick = GROWTH_BUILDS[it.id];
    if (!pick) continue;
    const [id, cover] = pick;
    const kind = buildingIndex(id);
    const group = BUILDINGS[kind].group;
    // One at a time, and none while the ones we have are short of staff (the town lacks the workers, not the buildings).
    if (t.tier < BUILDINGS[kind].tier || groupCount(t, group).building > 0 || staffFill(t, group) < GROWTH_STAFFED) continue;
    const cost = placeCost(t, kind, m.params);
    if (t.money.reserves - cost <= floor) continue; // only from the money above the safety floor
    const at = civicSite(t, m, kind, cover);
    if (!at) continue;
    try {
      applyBuild(t, `deputy.${m.dayIndex}.help.${id}`, [{ op: 'place', id, x: at[0], y: at[1], rot: 0 }], { params: m.params, dayIndex: m.dayIndex, profile: 'kid', deputy: true });
    } catch (e) {
      if (e instanceof EngineError) continue;
      throw e;
    }
    deputyNote(t, m, 'growthHelp.build', { building: id, item: it.id, cost }, id); // a card each
  }
}

/**
 * The growth-help order's jobs90 work: work for today's unemployed, plus the
 * workers of the Homes lots still waiting for builders, less the jobs of the
 * work lots already waiting. The lots go to the trade with the highest meter
 * above 0 (so they start under decision 7), Industry or Shops before Farms:
 * a Farms lot holds 3 jobs and never grows, so on Flatland, where the Farms
 * meter stands tallest, Bramble lined the roads with farms and the Village
 * stalled short of Town (G3). At most `tiles` lots a day in all (the day's
 * months share them), by the roads, first where the homes reach no work
 * within the longest commute (§5.9). When the roads are full, a short Lane
 * first (decision 8's, up to GROWTH_LANES a day); when that is not enough,
 * the empty Homes lots beyond GROWTH_KEEP_HOMES are repainted for work.
 */
function growthJobs(t: TownState, m: MonthContext, memo: CivicMemo, tiles: number, floor: number): void {
  const left = tiles - (memo.helpTiles ?? 0);
  if (left <= 0) return;
  const { unemployed, workforce } = unemploymentOf(m);
  const pop = population(t);
  let wanted = unemployed + (pop > 0 ? (workforce / pop) * emptyLots(t, Z_HOMES) * ZONE_DEFS[Z_HOMES].capacity[0] : 0);
  for (const [z] of JOB_ZONES) wanted -= emptyLots(t, z) * ZONE_DEFS[z].capacity[0];
  if (wanted <= 0) return; // the lots are down; the builders will fill them
  const trades = JOB_ZONES.filter(([z, k]) => zoneAllowed(t, z) && t.meters[k] > 0).sort((a, b) => t.meters[b[1]] - t.meters[a[1]]);
  if (trades.length === 0) return; // no trade wants workers: lots would sit empty (decision 7)
  const z = (trades.find(([q]) => q !== Z_FARMS) ?? trades[0])[0];
  const want = Math.min(left, Math.ceil(wanted / ZONE_DEFS[z].capacity[0]));
  const far = farDistricts(t, m);
  const plan = { id: `deputy.${m.dayIndex}.help.zone.${ZONE_DEFS[z].id}`, day: m.dayIndex };
  let n = zoneRoadside(t, z, want, plan, far);
  if (n < want && awayRoad(t, m, memo, floor, GROWTH_LANES)) n += zoneRoadside(t, z, want - n, plan, far);
  if (n > 0) deputyNote(t, m, 'growthHelp.jobs', { tiles: n, zone: ZONE_DEFS[z].id }, ZONE_DEFS[z].id); // one card a trade a day
  // Still short, and the roads lined with Homes lots no builder has started: repaint the surplus for work.
  const r = n < want ? rezoneEmptyHomes(t, z, want - n, { id: `deputy.${m.dayIndex}.help.rezone.${ZONE_DEFS[z].id}`, day: m.dayIndex }, far, attachOf(t, m)) : 0;
  if (r > 0) deputyNote(t, m, 'growthHelp.rezone', { tiles: r, zone: ZONE_DEFS[z].id }, ZONE_DEFS[z].id);
  memo.helpTiles = (memo.helpTiles ?? 0) + n + r;
}

/** Repays up to `amount` of the Town Loan with the 1% early-repayment fee; returns the principal repaid. */
export function repayLoan(t: TownState, amount: number, p: Params): number {
  const loan = t.money.loan;
  if (!loan) return 0;
  const principal = Math.min(Math.floor(amount), Math.ceil(loan.principal));
  if (principal <= 0) return 0;
  const fee = Math.round(principal * p.finance.earlyRepay);
  postWhole(t, 'repayment', -principal);
  postWhole(t, 'interest', -fee);
  loan.principal -= principal;
  if (loan.principal < 1) t.money.loan = null;
  else loan.payment = levelPayment(loan.principal, loan.rate, loan.monthsLeft); // same term, smaller payment
  return principal;
}

/**
 * The away order's zoning: up to `left` roadside tiles split evenly between the
 * zones whose meter is above `meterAt` (Homes, Shops, then the job zone),
 * the remainder to Homes first. `kinds` counts the zones wanted.
 */
function zoneWanted(t: TownState, plan: ZonePlan, left: number, meterAt: number, shopsAt = meterAt): { kinds: number; homes: number; shops: number; jobs: number } {
  const homes = zoneAllowed(t, Z_HOMES) && Math.max(t.meters[0], t.meters[1], t.meters[2]) > meterAt;
  const shops = zoneAllowed(t, Z_SHOPS) && t.meters[METER_SHOPS] > shopsAt;
  // Review amendment to §5.18: also the job zone (Industry or Farms, the higher meter) when it is
  // wanted. With Homes and Shops alone a town whose people had no work sat at a fixed point no
  // order could leave (Bramble's steps give 10 jobs for 96 founders: G8).
  const ind = zoneAllowed(t, Z_INDUSTRY) && t.meters[METER_INDUSTRY] > meterAt ? t.meters[METER_INDUSTRY] : -Infinity;
  const farm = zoneAllowed(t, Z_FARMS) && t.meters[METER_FARMS] > meterAt ? t.meters[METER_FARMS] : -Infinity;
  const jobZone = ind === -Infinity && farm === -Infinity ? -1 : farm > ind ? Z_FARMS : Z_INDUSTRY;
  const kinds = (homes ? 1 : 0) + (shops ? 1 : 0) + (jobZone >= 0 ? 1 : 0);
  if (left <= 0 || kinds === 0) return { kinds, homes: 0, shops: 0, jobs: 0 };
  // An even split, the remainder to Homes first (fixed order: Homes, Shops, jobs).
  const share = Math.floor(left / kinds);
  let extra = left - share * kinds;
  const quota = () => share + (extra-- > 0 ? 1 : 0);
  const h = homes ? zoneRoadside(t, Z_HOMES, quota(), plan) : 0;
  const s = shops ? zoneRoadside(t, Z_SHOPS, jobZone >= 0 ? quota() : left - h, plan) : 0;
  const j = jobZone >= 0 ? zoneRoadside(t, jobZone, left - h - s, plan) : 0;
  return { kinds, homes: h, shops: s, jobs: j };
}

/** Runs the standing orders in their list order (M13). "Hold" switches every other order off. */
export function runOrders(t: TownState, m: MonthContext, books: MonthBooks): void {
  if (orderOn(t, 'hold')) return;
  MAYOR_TODAY = mayorTilesToday(t, m.dayIndex);
  try {
    runEach(t, m, books);
  } finally {
    MAYOR_TODAY = null;
  }
}

function runEach(t: TownState, m: MonthContext, books: MonthBooks): void {
  const memo = civicMemo(t);
  const spend = Math.max(1, books.spending);
  for (const o of t.orders) {
    if (!o.on) continue;
    switch (o.kind) {
      case 'budgetHealthy': {
        const [months, maxBp] = o.args;
        const low = t.money.reserves < months * spend;
        if (!low) {
          memo.deputyRaised = 0;
          break;
        }
        if (t.money.reserves >= t.books.open) break; // under the line but not falling
        if (t.funding[FUN] !== FUND_LOW || t.funding[CULTURE] !== FUND_LOW) {
          t.funding[FUN] = FUND_LOW;
          t.funding[CULTURE] = FUND_LOW;
          deputyNote(t, m, 'budgetHealthy.funding', { months: Math.round(monthsOfSpending(t) * 10) / 10 });
          break;
        }
        const step = Math.min(m.params.civic.deputyStep, maxBp - memo.deputyRaised);
        const top = m.params.finance.ranges.homes[1];
        if (step <= 0 || t.taxes.homes.every((v) => v >= top)) break;
        t.taxes = { ...t.taxes, homes: t.taxes.homes.map((v) => Math.min(top, v + step)), town: Math.min(top, t.taxes.town + step) };
        memo.deputyRaised += step;
        deputyNote(t, m, 'budgetHealthy.tax', { bp: step });
        break;
      }
      case 'awayZoning': {
        const [tiles, orderMeterAt, months] = o.args;
        // G8: a Hamlet's Homes and job meters sit at 20–45, below the order's 60, so it zones them from a lower
        // line there. Shops keep the order's line: a hamlet's shops are the market item's (decision 6), and
        // extra Shops lots on a small town's spending only cycle its Shops meter round zero (G10).
        const meterAt = t.tier === 0 ? Math.min(orderMeterAt, m.params.civic.awayHamletMeterAt) : orderMeterAt;
        const away = m.at - t.away.lastHelloAt > m.params.clock.awayAfterMs;
        if (!away || t.money.reserves <= months * spend) break;
        if (memo.zonedDay !== m.dayIndex) {
          memo.zonedDay = m.dayIndex;
          memo.zonedToday = 0;
        }
        // Decision 6: the Village checklist's civic items first; the market's lots share the daily allowance.
        const floor = months * spend;
        const civic = awayCivic(t, m, memo, floor, Math.max(0, Math.floor(tiles) - memo.zonedToday));
        memo.zonedToday += civic.tiles;
        let left = Math.max(0, Math.floor(tiles) - memo.zonedToday);
        const plan = { id: `deputy.${m.dayIndex}.zone`, day: m.dayIndex };
        let z = zoneWanted(t, plan, left, meterAt, orderMeterAt);
        // Decision 8: wanted lots but no free roadside land left (for them or the market): one short lane a day,
        // then the rest of today's allowance on its new frontage.
        if ((civic.starved || (z.kinds > 0 && z.homes + z.shops + z.jobs < left)) && awayRoad(t, m, memo, floor)) {
          left -= z.homes + z.shops + z.jobs;
          const more = zoneWanted(t, plan, left, meterAt, orderMeterAt);
          z = { kinds: z.kinds, homes: z.homes + more.homes, shops: z.shops + more.shops, jobs: z.jobs + more.jobs };
        }
        memo.zonedToday += z.homes + z.shops + z.jobs;
        if (z.homes + z.shops + z.jobs > 0) deputyNote(t, m, 'awayZoning', { homes: z.homes, shops: z.shops, jobs: z.jobs });
        break;
      }
      case 'growthHelp': {
        const [tiles, months, marginPts] = o.args;
        growthHelp(t, m, memo, tiles, months * spend, marginPts);
        break;
      }
      case 'repayLoan': {
        const [months] = o.args;
        if (!t.money.loan) break;
        const spare = t.money.reserves - months * monthlySpending(t);
        if (spare <= 0) break;
        const paid = repayLoan(t, spare / (1 + m.params.finance.earlyRepay), m.params);
        if (paid > 0) deputyNote(t, m, 'repayLoan', { paid });
        break;
      }
      case 'fixDamaged': {
        const bill = -t.books.lines[lineIndex('repairs')];
        if (bill > 0) deputyNote(t, m, 'fixDamaged', { cost: bill });
        break;
      }
      case 'buyUtilities': {
        // WP2a's M2 already imported (autoImport reads this switch); Bramble only reports it.
        const u = m.derived.utilities;
        if (u && (u.powerImported > 0 || u.waterImported > 0)) deputyNote(t, m, 'buyUtilities', { power: Math.round(u.powerImported), water: Math.round(u.waterImported), cost: Math.round(u.importCost) });
        break;
      }
      default:
        break;
    }
  }
}

// ---- The `orders` move ------------------------------------------------------------------------------------

/**
 * Replaces the town's standing orders. Adults may reorder, drop and edit
 * thresholds (bounded, at most MAX_ORDERS orders, each kind once); a child's seat may
 * only switch the existing orders on and off.
 */
export function ordersMove(c: CountyState, townIndex: number, cmd: Command, actor: Actor): CommandResult {
  if (cmd.type !== 'orders') throw new EngineError(400, 'That move is not a set of orders.');
  const t = c.towns[townIndex];
  const list = cmd.orders;
  if (!Array.isArray(list) || list.length > MAX_ORDERS) throw new EngineError(400, `Bramble can keep up to ${MAX_ORDERS} orders.`);
  const seen = new Set<string>();
  const next: StandingOrder[] = [];
  for (const o of list) {
    const def = ORDER_DEFAULTS.find((d) => d.kind === o?.kind);
    if (!def) throw new EngineError(400, 'That is not an order Bramble knows.');
    if (seen.has(def.kind)) throw new EngineError(400, 'Each order can only be given once.');
    seen.add(def.kind);
    if (typeof o.on !== 'boolean') throw new EngineError(400, 'Each order is on or off.');
    const args = Array.isArray(o.args) ? o.args : [];
    if (args.length !== def.args.length) throw new EngineError(400, 'That order has the wrong number of settings.');
    const bounds = ARG_BOUNDS[def.kind] ?? [];
    args.forEach((v, k) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || v < bounds[k][0] || v > bounds[k][1]) throw new EngineError(400, 'That setting is out of range.');
    });
    next.push({ kind: def.kind, on: o.on, args: [...args] });
  }
  const profile = actor.profile ?? c.settings.perSeat[actor.seat]?.profile ?? 'adult';
  if (profile === 'kid') {
    const same = next.length === t.orders.length && next.every((o, k) => o.kind === t.orders[k].kind && o.args.length === t.orders[k].args.length && o.args.every((v, j) => v === t.orders[k].args[j]));
    if (!same) throw new EngineError(403, 'Ask a grown-up to change how Bramble’s orders work: you can switch them on and off.');
  }
  t.orders = next;
  return { ok: true, atTick: t.tick, cost: 0 };
}

// ---- Orders added since a town was made (decision 12) ---------------------------------------------------

/**
 * Decision 12: a child's town made before an order existed (the preview's
 * local rooms predate growthHelp) gets each default order it lacks, with the
 * child default and default thresholds, at its place in ORDER_DEFAULTS'
 * order; run when a room is revived. Pure and idempotent. Only children's
 * towns: a child's seat can switch orders but never drop one, so a missing
 * kind there can only be one that did not exist yet, while an adult may
 * have dropped one on purpose (and the new orders are off for adults
 * anyway). Never past MAX_ORDERS. Returns the orders added.
 */
export function backfillOrders(c: CountyState): number {
  let added = 0;
  for (const t of c.towns) {
    if (t.archived || (c.settings.perSeat[t.seat]?.profile ?? 'adult') !== 'kid') continue;
    for (let k = 0; k < ORDER_DEFAULTS.length && t.orders.length < MAX_ORDERS; k++) {
      const def = ORDER_DEFAULTS[k];
      if (t.orders.some((o) => o.kind === def.kind)) continue;
      // Before the first order that comes after it in the defaults, else at the end.
      const later = new Set(ORDER_DEFAULTS.slice(k + 1).map((d) => d.kind));
      const at = t.orders.findIndex((o) => later.has(o.kind));
      const order: StandingOrder = { kind: def.kind, on: def.kid, args: [...def.args] };
      if (at < 0) t.orders.push(order);
      else t.orders.splice(at, 0, order);
      added++;
    }
  }
  return added;
}
