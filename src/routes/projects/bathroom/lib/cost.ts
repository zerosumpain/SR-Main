// The cost model. 2026 North East rates: a full supply-and-fit bathroom in
// Darlington clusters £4,400–£11,700 with the middle of the pack near £6,800,
// and labour takes 45–60% of it. Every figure here is a sanity check on a
// written quote, not a quote.

import type { Stats } from './checks';

export type Tier = 0 | 1 | 2;
export const TIERS = ['Basic', 'Middle', 'Best'] as const;

export interface CostLine {
  cat: CatId;
  id: string;
  n: string;
  s: string;
  t: [number, number, number];
  per?: 'wall' | 'floor';
  mat?: boolean; // priced per m² and bought with a waste allowance
  opt?: boolean; // can be switched off
  off?: boolean; // starts switched off
}

export type CatId = 'labour' | 'suite' | 'surf' | 'svc';

/* Bar colours are site tokens, ordered so no two adjacent bands collide for a
   colour-blind reader; every band is also named and priced in the key. */
export const CATS: { id: CatId; n: string; c: string }[] = [
  { id: 'labour', n: 'Labour and trades', c: 'var(--accent-ink)' },
  { id: 'suite', n: 'Suite, brassware and fittings', c: 'var(--accent)' },
  { id: 'surf', n: 'Tiling, walls and floor', c: '#8a2d3a' },
  { id: 'svc', n: 'Services and the awkward extras', c: '#2d7a3a' },
];
export const CONTINGENCY_COLOUR = '#b0892a';

export const COST: CostLine[] = [
  { cat: 'labour', id: 'strip', n: 'Strip out and skip', s: 'Old suite, tiles and floor out, waste gone', t: [420, 620, 880] },
  { cat: 'labour', id: 'plumb', n: 'Plumbing, first and second fix', s: 'Pipework, wastes, connecting everything up', t: [700, 1050, 1550] },
  { cat: 'labour', id: 'elec', n: 'Electrics and the Part P certificate', s: 'Fan, lights, spurs, RCD, notification', t: [380, 680, 1150] },
  { cat: 'labour', id: 'plaster', n: 'Boarding and plastering', s: 'Board the wet walls, skim the rest, ceiling made good', t: [300, 500, 820] },
  { cat: 'labour', id: 'tilelab', n: 'Tiling labour', s: 'Setting out, cutting, fixing, grouting', t: [42, 58, 80], per: 'wall' },
  { cat: 'labour', id: 'floorlab', n: 'Floor prep and fitting', s: 'Overlay board, levelling, laying', t: [180, 320, 540] },
  { cat: 'labour', id: 'joinery', n: 'Joinery, boxing and door', s: 'Boxing pipework, floor repairs, trims, a new door', t: [180, 420, 780], opt: true, off: true },
  { cat: 'labour', id: 'decor', n: 'Making good and decorating', s: 'Filling, caulking, two coats of bathroom paint', t: [160, 320, 540], opt: true, off: true },

  { cat: 'suite', id: 'bath', n: 'Bath, panel and waste', s: 'Reinforced acrylic, proper feet, solid front panel', t: [190, 430, 1150], opt: true },
  { cat: 'suite', id: 'tray', n: 'Shower tray or former, and screen', s: 'Low-profile tray or wet-room former, plus the glass', t: [280, 700, 1850], opt: true, off: true },
  { cat: 'suite', id: 'valve', n: 'Shower valve and head', s: 'Thermostatic. The one thing not to skimp on.', t: [100, 310, 790], opt: true },
  { cat: 'suite', id: 'wc', n: 'WC, cistern and seat', s: 'Close-coupled, or wall-hung on a concealed frame', t: [140, 360, 880] },
  { cat: 'suite', id: 'basin', n: 'Basin or vanity unit', s: 'Pedestal basin, or a unit with storage underneath', t: [140, 450, 1180] },
  { cat: 'suite', id: 'taps', n: 'Taps and wastes', s: 'Basin mixer, bath filler, click wastes', t: [80, 210, 500] },
  { cat: 'suite', id: 'store', n: 'Extra storage or mirrored cabinet', s: 'Tall unit, cabinet, or a fitted run', t: [100, 300, 760], opt: true, off: true },
  { cat: 'suite', id: 'access', n: 'Mirror, rails and accessories', s: 'Mirror, towel ring, roll holder, hooks', t: [80, 200, 450] },

  { cat: 'surf', id: 'walltile', n: 'Wall tiles', s: 'Ceramic → porcelain → large-format or patterned', t: [17, 44, 96], per: 'wall', mat: true },
  { cat: 'surf', id: 'floor', n: 'Floor covering', s: 'Vinyl → LVT or porcelain → large-format porcelain', t: [24, 50, 100], per: 'floor', mat: true },
  { cat: 'surf', id: 'backer', n: 'Backer board, tanking and adhesive', s: 'Insulated board on the cold walls, tanking in the shower', t: [200, 400, 820] },
  { cat: 'surf', id: 'trims', n: 'Trims, grout and silicone', s: 'Edge trims, anti-mould grout and sanitary sealant', t: [80, 150, 280] },

  { cat: 'svc', id: 'rail', n: 'Heated towel rail', s: 'Size it on watts, not on looks', t: [100, 260, 640] },
  { cat: 'svc', id: 'ufh', n: 'Electric underfloor heating', s: 'Mat, insulation board and a thermostat', t: [290, 500, 860], opt: true, off: true },
  { cat: 'svc', id: 'fan', n: 'Extractor fan, ducted outside', s: '15 l/s minimum. Humidity-sensing is worth the extra.', t: [60, 160, 350] },
  { cat: 'svc', id: 'light', n: 'Lighting and switching', s: 'IP-rated downlights, dimmer, something at the mirror', t: [100, 280, 650] },
  { cat: 'svc', id: 'movewc', n: 'Moving the WC or the waste', s: 'New falls, boxing in, possibly a macerator', t: [320, 650, 1100], opt: true, off: true },
  { cat: 'svc', id: 'water', n: 'Pump, valve or hot water upgrade', s: "Only if the boiler can't run the shower you want", t: [380, 950, 2300], opt: true, off: true },
  { cat: 'svc', id: 'floorfix', n: 'Floor repairs', s: 'Rot, movement or levelling under the old suite', t: [220, 450, 820], opt: true, off: true },
  { cat: 'svc', id: 'ceiling', n: 'Ceiling replacement', s: 'If the lath and plaster comes down with the old tiles', t: [320, 500, 720], opt: true, off: true },
];

export const COVER = {
  wet: { f: 0.42, n: 'Wet walls only' },
  half: { f: 0.58, n: 'Half height all round' },
  full: { f: 0.9, n: 'Floor to ceiling' },
} as const;
export type CoverKey = keyof typeof COVER;

export const ROUTE = {
  A: { m: 1.2, n: 'One firm, end to end' },
  B: { m: 1.0, n: "A fitter with his own trades" },
  C: { m: 0.93, n: 'You run it' },
} as const;
export type RouteKey = keyof typeof ROUTE;

export const PRIOS = [
  { id: 'shower', n: 'A proper shower', d: "Bigger enclosure, a valve you'll enjoy" },
  { id: 'keepbath', n: 'Keep a bath', d: 'Bath stays in the room' },
  { id: 'warm', n: 'Warm underfoot', d: 'Underfloor heating and insulated walls' },
  { id: 'tiles', n: 'Tiles floor to ceiling', d: 'Fully tiled rather than half height' },
  { id: 'storage', n: 'Somewhere to put things', d: 'Vanity unit and a tall cupboard' },
  { id: 'light', n: 'Lighting done properly', d: 'Downlights, a dimmer, light at the mirror' },
  { id: 'quick', n: 'As cheap as does a good job', d: 'Nothing fancy, nothing nasty' },
];

const PRIO_ITEMS: Record<string, string[]> = {
  shower: ['valve', 'tray', 'tilelab'],
  keepbath: ['bath'],
  warm: ['ufh', 'rail', 'backer'],
  tiles: ['walltile', 'tilelab'],
  storage: ['store', 'basin'],
  light: ['light', 'elec'],
  quick: [],
};

const UPGRADE_ORDER = [
  'valve', 'backer', 'fan', 'tilelab', 'floor', 'walltile', 'wc', 'basin', 'taps', 'bath',
  'tray', 'light', 'rail', 'plumb', 'elec', 'plaster', 'store', 'access', 'trims', 'joinery',
  'decor', 'strip', 'floorlab', 'ufh',
];

export interface ItemState {
  on: boolean;
  tier: Tier;
}
export interface CostState {
  mode: 'pick' | 'budget';
  route: RouteKey;
  cont: number;
  cover: CoverKey;
  budget: number;
  prios: string[];
  items: Record<string, ItemState>;
}

export const defaultCost = (): CostState => ({
  mode: 'pick',
  route: 'B',
  cont: 12,
  cover: 'half',
  budget: 8000,
  prios: [],
  items: Object.fromEntries(COST.map((i) => [i.id, { on: !i.off, tier: 1 as Tier }])),
});

export interface Quantities {
  wall: number;
  floor: number;
}

/** Tiling and flooring areas, sized off the room in the planner. */
export function quantities(st: Stats, cover: CoverKey): Quantities {
  return {
    wall: Math.round(Math.max(4, st.perim * 2.4 * COVER[cover].f) * 10) / 10,
    floor: Math.round(Math.max(1.5, st.net) * 10) / 10,
  };
}

export function lineTotal(line: CostLine, s: CostState, q: Quantities): number {
  const st = s.items[line.id];
  if (!st?.on) return 0;
  const unit = line.t[st.tier];
  if (line.per === 'wall') return unit * q.wall * (line.mat ? 1.1 : 1);
  if (line.per === 'floor') return unit * q.floor * (line.mat ? 1.08 : 1);
  return unit;
}

export interface Totals {
  q: Quantities;
  by: Record<CatId, number>;
  sub: number;
  cont: number;
  total: number;
}

export function totals(s: CostState, stats: Stats): Totals {
  const q = quantities(stats, s.cover);
  const by = { labour: 0, suite: 0, surf: 0, svc: 0 } as Record<CatId, number>;
  for (const line of COST) by[line.cat] += lineTotal(line, s, q);
  const m = ROUTE[s.route].m;
  let sub = 0;
  for (const c of CATS) {
    by[c.id] *= m;
    sub += by[c.id];
  }
  const cont = (sub * s.cont) / 100;
  return { q, by, sub, cont, total: sub + cont };
}

export function daysOnSite(s: CostState): number {
  let d = 7;
  if (s.items.bath.on && s.items.tray.on) d += 2;
  if (s.items.movewc.on) d += 2;
  if (s.cover === 'full') d += 1.5;
  else if (s.cover === 'wet') d -= 0.5;
  if (s.items.ufh.on) d += 0.5;
  if (s.items.floorfix.on) d += 1;
  if (s.items.ceiling.on) d += 1;
  if (s.route === 'C') d += 3;
  return Math.round(d);
}

/**
 * Budget mode. Start everything at the cheapest tier, then walk an upgrade
 * order — priority-linked lines first — lifting each one a tier at a time for
 * as long as the budget stands it.
 */
export function buildSpec(s: CostState, stats: Stats): string {
  const p = s.prios;
  for (const line of COST) {
    s.items[line.id].on = !line.off;
    s.items[line.id].tier = 0;
  }
  if (p.includes('keepbath')) {
    s.items.bath.on = true;
    s.items.tray.on = p.includes('shower');
  } else if (p.includes('shower')) {
    s.items.bath.on = false;
    s.items.tray.on = true;
  }
  s.items.valve.on = true;
  if (p.includes('warm')) s.items.ufh.on = true;
  if (p.includes('storage')) s.items.store.on = true;
  s.cover = p.includes('tiles') ? 'full' : p.includes('quick') ? 'wet' : 'half';

  const cap: Tier = p.includes('quick') ? 1 : 2;
  const order: string[] = [];
  for (const x of p) for (const id of PRIO_ITEMS[x] ?? []) if (!order.includes(id)) order.push(id);
  for (const id of UPGRADE_ORDER) if (!order.includes(id)) order.push(id);

  const base = totals(s, stats).total;
  if (base > s.budget)
    return `At the cheapest of everything this spec is ${money(base)} — ${money(base - s.budget)} over. Drop the underfloor heating, tile less, or lift the budget.`;

  let up = 0;
  for (let pass = 1 as Tier; pass <= cap; pass++) {
    for (const id of order) {
      const st = s.items[id];
      if (!st || !st.on || st.tier >= pass) continue;
      const old = st.tier;
      st.tier = pass;
      if (totals(s, stats).total > s.budget) st.tier = old;
      else up++;
    }
  }
  const t = totals(s, stats).total;
  const left = s.budget - t;
  return `Spec built: ${money(t)} of your ${money(s.budget)}. ${up} line${up === 1 ? '' : 's'} upgraded${
    left > 400 ? `, ${money(left)} still on the table — nudge something up below.` : '.'
  }`;
}

export const money = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
