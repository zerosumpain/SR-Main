// Growth stages (WP2d, spec §7): each tier's checklist, the hold before a
// promotion, and the promotion itself. A town moves up only when it has the
// population AND every checklist item at two consecutive Regional Days
// (hysteresis, so a town hovering at the line is not promoted on a lucky
// day). There is no demotion: a town that shrinks keeps its tier and every
// unlock, and shows a gentle "struggling" badge with a Bramble card instead.
//
// The checklist is judged at each month end (M14), when the month's
// coverage, utilities and labour numbers exist; the Regional Day reads the
// last month's verdict from the civic memo, because the blackboard has been
// thrown away by then (§10.2).

import { BUILDINGS, TIER_DEFS, ZONE_DEFS } from './content';
import { population } from './core';
import { neutral } from './derived';
import { civicMemo } from './finance';
import { paramsFor } from './params';
import { B_KIND, B_X, B_Y, CAT_ZONE, CELLS, TILES, cellOf, constructionLeft, lvlLevel, pairPlane, planesOf, tileIndex, useCat, usePayload } from './tiles';
import { COVERAGES, STARS, Z_HOMES, Z_SHOPS, type CountyState, type MonthContext, type RegionalContext, type TownState } from './types';

/** Everything a checklist item looks at, gathered once per month end. */
export interface CheckFacts {
  pop: number;
  approval: number;
  /** Shares of homes (by residents' capacity) watered, and of built tiles powered. */
  wateredHomes: number;
  poweredTiles: number;
  shopTiles: number;
  /** Finished buildings by catalogue id. */
  built: Record<string, number>;
  /** Share of homes whose cell's coverage of each COVERAGES kind reaches civic.coveredAt. */
  covered: number[];
  primarySeats: number;
  secondarySeats: number;
  unemployment: number;
  safety: number;
  cultureStar: number;
  transitShare: number;
  landmarks: number;
  pollution: number;
  rating: number;
  /** The Great Metropolis title's Culture star (params civic.greatMetropolis[1]). */
  greatCulture: number;
}

export interface CheckItem {
  id: string;
  ok(f: CheckFacts): boolean;
}

const cov = (k: (typeof COVERAGES)[number]) => COVERAGES.indexOf(k);
const has = (f: CheckFacts, ...ids: string[]) => ids.some((id) => (f.built[id] ?? 0) > 0);

/** The items that must ALL hold to reach each tier (index = the tier reached; 5 is the Great Metropolis title). */
export const CHECKLISTS: readonly (readonly CheckItem[])[] = [
  [],
  [
    { id: 'water90', ok: (f) => f.wateredHomes >= 0.9 },
    { id: 'market', ok: (f) => f.shopTiles >= 6 },
    { id: 'school', ok: (f) => has(f, 'schoolHouse', 'villageSchool', 'primarySchool') },
    { id: 'green70', ok: (f) => Math.max(f.covered[cov('nature')], f.covered[cov('fun')]) >= 0.7 },
    { id: 'approval50', ok: (f) => f.approval >= 50 },
  ],
  [
    { id: 'surgery70', ok: (f) => f.covered[cov('health')] >= 0.7 },
    { id: 'police50', ok: (f) => f.covered[cov('police')] >= 0.5 },
    { id: 'fire70', ok: (f) => f.covered[cov('fire')] >= 0.7 },
    { id: 'power95', ok: (f) => f.poweredTiles >= 0.95 },
    { id: 'primary80', ok: (f) => f.primarySeats >= 0.8 },
    { id: 'jobs90', ok: (f) => f.unemployment <= 0.1 },
    { id: 'approval55', ok: (f) => f.approval >= 55 },
  ],
  [
    { id: 'secondary75', ok: (f) => f.secondarySeats >= 0.75 },
    { id: 'healthCentre', ok: (f) => has(f, 'healthCentre', 'hospital') },
    { id: 'libraryMuseum', ok: (f) => has(f, 'library', 'museum') },
    { id: 'bus40', ok: (f) => f.covered[cov('transit')] >= 0.4 },
    { id: 'safety60', ok: (f) => f.safety >= 60 },
    { id: 'jobs90', ok: (f) => f.unemployment <= 0.1 },
    { id: 'approval55', ok: (f) => f.approval >= 55 },
  ],
  [
    { id: 'university', ok: (f) => has(f, 'university') },
    { id: 'culture60', ok: (f) => f.cultureStar >= 60 },
    { id: 'transit20', ok: (f) => f.transitShare >= 0.2 },
    { id: 'landmarks2', ok: (f) => f.landmarks >= 2 },
    { id: 'pollution45', ok: (f) => f.pollution <= 45 },
    { id: 'ratingA', ok: (f) => f.rating <= 2 },
    { id: 'approval60', ok: (f) => f.approval >= 60 },
  ],
  [{ id: 'culture75', ok: (f) => f.cultureStar >= f.greatCulture }],
];

/** The Great Metropolis title is checked as a pseudo-tier above Metropolis. */
export const GREAT_METROPOLIS = 5;

/** Population needed for tier `tier` (5: the Great Metropolis title). */
export function tierPopulation(tier: number, greatAt: number): number {
  return tier >= GREAT_METROPOLIS ? greatAt : (TIER_DEFS[tier]?.population ?? Infinity);
}

const isApproval = (id: string) => id.startsWith('approval');

/** The month's checklist facts from the blackboard (neutral values where a package is still a stub). */
export function checkFacts(t: TownState, m: MonthContext): CheckFacts {
  const d = m.derived;
  const u = d.utilities ?? neutral.utilities();
  const c = d.coverage ?? neutral.coverage(t);
  const lab = d.labour ?? neutral.labour();
  const dev = d.development;
  const fl = d.fields;
  const tv = d.travel ?? neutral.travel();
  const p = planesOf(t);
  const caps = ZONE_DEFS[Z_HOMES].capacity;
  const cellHomes = new Float64Array(CELLS);
  let homes = 0;
  let watered = 0;
  let shopTiles = 0;
  const left = pairPlane(t.construction);
  for (let i = 0; i < TILES; i++) {
    if (useCat(p.use[i]) !== CAT_ZONE) continue;
    const level = lvlLevel(p.lvl[i]);
    if (level === 0 || left[i] > 0) continue;
    const z = usePayload(p.use[i]);
    if (z === Z_SHOPS) shopTiles++;
    if (z !== Z_HOMES) continue;
    const w = caps[level - 1] ?? 0;
    homes += w;
    cellHomes[cellOf(i)] += w;
    if (u.watered[i]) watered += w;
  }
  const at = m.params.civic.coveredAt;
  const covered = COVERAGES.map((_, k) => {
    const field = c.cov[k];
    if (!field || homes <= 0) return 0;
    let n = 0;
    for (let cell = 0; cell < CELLS; cell++) if (cellHomes[cell] > 0 && field[cell] >= at) n += cellHomes[cell];
    return n / homes;
  });
  const built: Record<string, number> = {};
  let landmarks = 0;
  for (const b of t.buildings) {
    const def = BUILDINGS[b[B_KIND]];
    const anchor = tileIndex(b[B_X], b[B_Y]);
    if (!def || (anchor >= 0 && anchor < TILES ? left[anchor] > 0 : constructionLeft(t, anchor) > 0)) continue;
    built[def.id] = (built[def.id] ?? 0) + 1;
    if (def.group === 'landmark') landmarks++;
  }
  const workforce = (lab.workforce[0] ?? 0) + (lab.workforce[1] ?? 0) + (lab.workforce[2] ?? 0);
  const unemployed = (lab.unemployed[0] ?? 0) + (lab.unemployed[1] ?? 0) + (lab.unemployed[2] ?? 0);
  const stars = d.stars?.actual;
  return {
    pop: population(t),
    approval: t.approval,
    wateredHomes: homes > 0 ? watered / homes : 0,
    poweredTiles: u.poweredShare,
    shopTiles: dev ? dev.built[Z_SHOPS] : shopTiles,
    built,
    covered,
    primarySeats: c.pupils.primary > 0 ? c.seats.primary / c.pupils.primary : c.seats.primary > 0 ? 1 : 0,
    secondarySeats: c.pupils.secondary > 0 ? c.seats.secondary / c.pupils.secondary : c.seats.secondary > 0 ? 1 : 0,
    unemployment: workforce > 0 ? unemployed / workforce : 0,
    safety: fl ? fl.safety : 0,
    cultureStar: stars ? stars[STARS.indexOf('culture')] : 0,
    transitShare: tv.busShare + tv.railShare,
    landmarks,
    pollution: fl ? fl.pollutionPop : 0,
    rating: t.money.rating,
    greatCulture: m.params.civic.greatMetropolis[1],
  };
}

export interface CheckResult {
  tier: number;
  /** Bit k set: item k of CHECKLISTS[tier] holds. */
  met: number;
  items: number;
  /** Unmet items other than approval (Approval's own checklist term cannot count itself, §5.15). */
  unmetOthers: number;
}

/** Judges the next tier's checklist (for a Metropolis, the Great Metropolis title). */
export function judgeChecklist(t: TownState, f: CheckFacts): CheckResult {
  const tier = Math.min(GREAT_METROPOLIS, t.tier + 1);
  const items = CHECKLISTS[tier];
  let met = 0;
  let unmetOthers = 0;
  items.forEach((it, k) => {
    if (it.ok(f)) met |= 1 << k;
    else if (!isApproval(it.id)) unmetOthers++;
  });
  return { tier, met, items: items.length, unmetOthers };
}

/** The checklist's item ids with whether each holds (the Growth sheet and the advisors). */
export function checklistOf(t: TownState): { id: string; met: boolean }[] {
  const ch = t.civicMemo?.check;
  const tier = Math.min(GREAT_METROPOLIS, t.tier + 1);
  return CHECKLISTS[tier].map((it, k) => ({ id: it.id, met: !!ch && ch.tier === tier && (ch.met & (1 << k)) !== 0 }));
}

/** Does the town meet its next tier now (population and every item at the last month end)? */
export function meetsNextTier(t: TownState, greatAt: number): boolean {
  const ch = t.civicMemo?.check;
  const tier = Math.min(GREAT_METROPOLIS, t.tier + 1);
  if (!ch || ch.tier !== tier || t.trophies.includes('greatMetropolis')) return false;
  const all = ch.items >= 31 ? -1 : (1 << ch.items) - 1;
  return population(t) >= tierPopulation(tier, greatAt) && (ch.met & all) === all;
}

/**
 * The Regional Day's tier check (§8.3 step 7, WP2d's part): the struggling
 * badge, the two-day hold and the promotion (new parcel rights and a ribbon
 * cutting in the inbox; the Gazette and invitations are WP3's).
 */
export function stepTierCheck(c: CountyState, r: RegionalContext): void {
  const p = paramsFor(c.paramsVersion);
  const [greatAt] = p.civic.greatMetropolis;
  for (let i = 0; i < c.towns.length; i++) {
    const t = c.towns[i];
    if (t.archived) continue;
    const memo = civicMemo(t);
    const pop = population(t);
    if (pop > memo.peak) memo.peak = pop;
    memo.struggling = memo.peak > TIER_DEFS[1].population && pop < p.civic.struggleShare * memo.peak;
    if (!meetsNextTier(t, greatAt)) {
      t.tierHold = 0;
      continue;
    }
    t.tierHold += 1;
    if (t.tierHold < 2) continue;
    t.tierHold = 0;
    if (t.tier >= 4) {
      t.trophies.push('greatMetropolis');
      t.inbox.push({ id: `title.greatMetropolis.${r.dayIndex}`, kind: 'title', day: r.dayIndex, from: null, data: { title: 'greatMetropolis' } });
    } else {
      const next = (t.tier + 1) as 1 | 2 | 3 | 4;
      t.tier = next;
      t.parcelRights += TIER_DEFS[next].parcelRights;
      t.inbox.push({ id: `promotion.${next}.${r.dayIndex}`, kind: 'promotion', day: r.dayIndex, from: null, data: { tier: next, parcels: TIER_DEFS[next].parcelRights } });
    }
    while (t.inbox.length > 40) t.inbox.shift();
  }
}
