// The inspector (spec §9.5): a long press on any tile or building opens a
// card with what it is, its level and tier, who lives or works there and
// their mood, its top wants, the top terms of its land value and its growth
// score, and "What would make it grow?", which offers a one-tap ghost plan.
// The card is data: SwiftUI draws it in the app, the harness draws it in the
// DOM. The growth terms are WP2e's own explanation (`explainGrowth`), and the
// suggested plan is checked against the engine before it is offered.

import {
  BUILDINGS,
  B_KIND,
  CAT_BUILDING,
  CAT_RAIL,
  CAT_ROAD,
  CAT_ZONE,
  MAP,
  ROAD_KINDS,
  TIER_NAMES,
  ZONES,
  ZONE_DEFS,
  Z_HOMES,
  cellOf,
  constructionLeft,
  decodeCells,
  explainGrowth,
  inMap,
  lvlLevel,
  lvlTier,
  parcelOpen,
  planesOf,
  tileIndex,
  useCat,
  usePayload,
  type Op,
  type Params,
  type TownState,
} from './engine';
import type { InspectCardMsg } from './bridge/protocol';
import { groupDigits } from './format';
import { moodWords, wantLabel, type Derived } from './layers';
import { tierHappiness, type Space } from './lenses';
import { previewPlan, snapRoad, type PreviewEnv } from './plan/plan';

const MONEY = ['£', '££', '£££'];
const LV_WORDS: Record<string, string> = {
  'lv.jobs': 'near jobs',
  'lv.nature': 'parks and nature',
  'lv.school': 'schools',
  'lv.health': 'health care',
  'lv.culture': 'culture',
  'lv.transit': 'buses and trains',
  'lv.scenic': 'the view',
  'lv.premium': 'the town’s name',
  'lv.pollution': 'smoke',
  'lv.noise': 'noise',
  'lv.crime': 'safety worries',
  'lv.bonus': 'landmarks',
  'lv.potholes': 'potholes',
};
const titled = (s: string) => s[0].toUpperCase() + s.slice(1);

/** The nearest road tile to (x, y) by straight-line distance, or null. */
function nearestRoad(t: TownState, x: number, y: number): [number, number] | null {
  const use = planesOf(t).use;
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (let i = 0; i < use.length; i++) {
    if (useCat(use[i]) !== CAT_ROAD) continue;
    const rx = i % MAP;
    const ry = (i - rx) / MAP;
    const d = (rx - x) ** 2 + (ry - y) ** 2;
    if (d < bd) {
      bd = d;
      best = [rx, ry];
    }
  }
  return best;
}

/** The first of `candidates` the engine accepts as a whole plan, or null. */
function firstThatFits(t: TownState, env: PreviewEnv, candidates: Op[][]): Op[] | null {
  for (const ops of candidates) if (!previewPlan(t, ops, env).refused) return ops;
  return null;
}

/** Spots around (x, y), nearest first, to try a 1-tile building at. */
function around(x: number, y: number, reach: number): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 1; r <= reach; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (inMap(x + dx, y + dy)) out.push([x + dx, y + dy]);
      }
  return out;
}

/** A suggested plan for what holds this tile back, and the sentence that goes with it. */
function growSuggestion(t: TownState, x: number, y: number, blocked: string | null, terms: [string, number][], env: PreviewEnv): { line: string; plan: Op[] | null } {
  if (blocked === 'noRoad') {
    const r = nearestRoad(t, x, y);
    if (r) {
      // A lane from the nearest road to the tile's own row or column, stopping beside it.
      const tx = Math.abs(r[0] - x) > Math.abs(r[1] - y) ? x : r[0];
      const ty = tx === x ? r[1] : y + (r[1] < y ? -1 : 1);
      const plan = firstThatFits(t, env, [[{ op: 'road', kind: 'lane', path: snapRoad(r[0], r[1], tx, ty) }]]);
      return { line: 'It needs a road within 2 tiles.', plan };
    }
    return { line: 'It needs a road within 2 tiles.', plan: null };
  }
  if (blocked === 'levelCap') return { line: `It can grow bigger once your town grows to the next stage.`, plan: null };
  if (blocked === 'busy' || blocked === 'closed') return { line: blocked === 'busy' ? 'It is being built right now.' : 'It is closed for repairs.', plan: null };
  if (blocked === 'pollution') return { line: 'Families will not build homes in this much smoke.', plan: null };
  const missing = terms.find(([k]) => k === 'grow.unpowered') ? 'power' : terms.find(([k]) => k === 'grow.dry') ? 'water' : null;
  if (missing) {
    const id = missing === 'power' ? (t.tier >= 1 ? 'generator' : 'windmill') : t.tier >= 1 ? 'waterTower' : 'well';
    const plan = firstThatFits(t, env, around(x, y, 4).map(([px, py]) => [{ op: 'place', id, x: px, y: py, rot: 0 } as Op]));
    return { line: `It needs ${missing}: a ${BUILDINGS.find((b) => b.id === id)?.name ?? id} nearby would do it.`, plan };
  }
  if (blocked === 'landValue') {
    const id = t.tier >= 1 ? 'park' : 'pocketPark';
    const plan = firstThatFits(t, env, around(x, y, 3).map(([px, py]) => [{ op: 'place', id, x: px, y: py, rot: 0 } as Op]));
    return { line: 'Land here is not worth enough to build bigger. A park nearby raises it.', plan };
  }
  const meter = terms.find(([k]) => k === 'grow.meter')?.[1] ?? 0;
  if (meter <= 0) return { line: 'Nobody is asking for this kind of building yet: it grows when the demand bar is up.', plan: null };
  return { line: 'It should grow soon: builders visit every tile once a month.', plan: null };
}

export interface InspectInput {
  t: TownState;
  space: Space | null;
  params: Params;
  derived: Derived | null;
  env: PreviewEnv;
}

/** The inspector card for tile (x, y). */
export function inspectTile(x: number, y: number, i: InspectInput): InspectCardMsg {
  const { t, space, params, derived, env } = i;
  const tile = tileIndex(x, y);
  const p = planesOf(t);
  const u = p.use[tile];
  const cat = useCat(u);
  const lvCells = decodeCells(t.lv);
  const lvValue = lvCells[cellOf(tile)];
  const landValue = space
    ? {
        value: lvValue,
        terms: space
          .lvTerms(cellOf(tile))
          .filter(([k, v]) => k !== 'lv.base' && Math.abs(v) >= 0.5)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1))
          .slice(0, 3)
          .map(([k, v]) => [LV_WORDS[k] ?? k, Math.round(v)] as [string, number]),
      }
    : { value: lvValue, terms: [] };
  const card: InspectCardMsg = { title: '', kind: 'land', level: null, tier: null, who: null, mood: null, wants: [], landValue, grow: null, growLine: null, growPlan: null };
  if (!parcelOpen(t, x, y) && cat !== CAT_ROAD) {
    card.kind = 'locked';
    card.title = 'Land you can open later';
    card.growLine = t.parcelRights > 0 ? 'You can open this land now with “Open new land”.' : 'New land comes with your next promotion.';
    return card;
  }
  if (cat === CAT_ROAD) {
    card.kind = 'road';
    card.title = `${titled(ROAD_KINDS[usePayload(u)])} road`;
    return card;
  }
  if (cat === CAT_RAIL) {
    card.kind = 'rail';
    card.title = 'Railway';
    return card;
  }
  if (cat === CAT_BUILDING) {
    const b = t.buildings[usePayload(u)];
    const def = b ? BUILDINGS[b[B_KIND]] : null;
    card.kind = 'building';
    card.title = def?.name ?? 'Building';
    const left = b ? constructionLeft(t, tileIndex(b[1], b[2])) : 0;
    card.who = def && def.staff > 0 ? `${def.staff} staff work here` : null;
    if (left > 0) card.growLine = `Being built: ready in ${left} week${left === 1 ? '' : 's'}.`;
    else if (def?.note) card.growLine = def.note;
    return card;
  }
  if (cat === CAT_ZONE) {
    const z = usePayload(u);
    const level = lvlLevel(p.lvl[tile]);
    const tier = lvlTier(p.lvl[tile]);
    card.kind = 'zone';
    card.level = level;
    card.tier = z === Z_HOMES ? tier : null;
    card.title = level === 0 ? `${titled(ZONES[z])} lot` : `${titled(ZONES[z])}, level ${level}${z === Z_HOMES ? ` ${MONEY[tier]}` : ''}`;
    const cap = ZONE_DEFS[z]?.capacity[level - 1] ?? 0;
    if (level > 0) card.who = z === Z_HOMES ? `Home to about ${groupDigits(cap)} people` : `About ${groupDigits(cap)} jobs`;
    if (z === Z_HOMES && level > 0) card.mood = moodWords(tierHappiness(t, tier));
    if (derived) {
      const row = z === Z_HOMES ? derived.needs.find((r) => r.tier === tier) : null;
      const unmet = row ? row.items.filter((it) => it.met < 0.5).slice(0, 2).map((it) => `${MONEY[tier]} families would love a ${it.key}`) : [];
      card.wants = unmet.length ? unmet : derived.wants.slice(0, 2).map((w) => wantLabel(w.key, derived));
    }
    const g = explainGrowth(t, tile, params);
    card.grow = { score: Math.round(g.z), chance: Math.round(g.chance * 100) / 100, blocked: g.blocked, terms: g.terms.map(([k, v]) => [k, Math.round(v)]) };
    const s = growSuggestion(t, x, y, g.blocked, g.terms, env);
    card.growLine = s.line;
    card.growPlan = s.plan;
    return card;
  }
  card.title = 'Open land';
  card.growLine = `${titled(TIER_NAMES[t.tier])} land: zone it, or build on it.`;
  return card;
}
