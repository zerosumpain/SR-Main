// The bot mayors (spec §11.2): twelve ways of playing, plus the Spammer of
// §5.22, each a Policy = (view, rng) → Command[] with a session model
// (sessions per day, actions per session). They play through the same move
// API as a phone (applyCommand), read only what a phone sees (view.ts), and
// share one planner (planner.ts), so the differences between them are
// choices, not competence: Balanced and Greedy Taxer lay out the same roads;
// what differs is the tax dial, the services they buy and what they zone.
//
// A bot never needs a move to succeed. The Lab applies its commands in order
// and counts the refusals, which are themselves a balance signal (a Debt
// Spender refused by the debt cap, a Kid refused by an empty purse).
//
// Bots are deterministic: the only randomness is the rng the Lab hands in,
// which is a pure function of the run's seed, the seat and the session.

import { BUILDINGS, ZONE_DEFS, buildingIndex } from '../content';
import { FUNDING_GROUPS, ZONES, Z_FARMS, Z_HOMES, Z_INDUSTRY, Z_LEISURE, Z_OFFICES, Z_SHOPS, type Command, type Op, type TownState } from '../types';
import { MAP } from '../tiles';
import type { Params } from '../params';
import {
  bestParcel,
  buildingCounts,
  claimSite,
  coverageShare,
  findSite,
  growRoads,
  lensAdd,
  lensOf,
  mapOf,
  pickLots,
  placeCostOf,
  roadOps,
  roadTileCost,
  upgradeCandidates,
  utilityBalance,
  zoneCounts,
  zoneOps,
  type SiteGoal,
  type TownMap,
} from './planner';
import type { BotView } from './view';

/** A uniform draw in [0, 1). Each call advances the bot's own counter-based stream. */
export type BotRng = () => number;

export type Policy = (view: BotView, rng: BotRng) => Command[];

export const BOT_IDS = [
  'balanced',
  'tourist',
  'industrial',
  'suburb',
  'greedy',
  'debt',
  'poacher',
  'hermit',
  'cooperator',
  'kid',
  'weekly',
  'absent',
  'spammer',
] as const;
export type BotId = (typeof BOT_IDS)[number];

/** Names the Lab's command line also accepts (the task list's words for the same bots). */
export const BOT_ALIASES: Record<string, BotId> = { idle: 'absent', 'greedy-tax': 'greedy', greedyTaxer: 'greedy', borrower: 'debt', debtSpender: 'debt' };

export interface SessionModel {
  /** Local hours (Europe/London) of each session; the Lab turns them into instants around the Regional Day. */
  hours: number[];
  /** Commands (other than hello) per session. */
  actions: number;
  /** Only on the County Week day (Sunday's Regional Day). */
  sundaysOnly?: boolean;
  /** Most actions in a whole day (the Kid's three). */
  perDay?: number;
}

/** What makes one bot different from another: dials, not skill. */
export interface Style {
  /** Homes (Town) tax target, basis points; the business rate follows the Town Tax rule (half). */
  homesTax: number;
  /** Lowest and highest homes tax the fiscal adjustment may reach. */
  taxBand: [number, number];
  /** Months of spending kept back from any build. */
  keepMonths: number;
  /** 0 buys only what a checklist demands; 1 keeps every service at its target; > 1 overbuilds. */
  services: number;
  /** Multipliers on meter-driven zoning, ZONE order. */
  zoneMix: number[];
  /** A meter must exceed this before a bot zones for it. */
  meterAt: number;
  power: 'cheap' | 'clean' | 'dirty';
  borrow: boolean;
  tourism: boolean;
  /** Probability of following the top advisor card (Kid 0.6, Balanced 1). */
  advisorFollow: number;
  /** Probability per session of undoing the session's last plan (the Kid). */
  undo: number;
  /** Extra weight on parks (the Kid over-builds them). */
  parks: number;
  /** Zones every free lot as Homes (the Spammer of §5.22). */
  spamHomes: boolean;
  /** Funding level the bot sets (Greedy: Low). */
  funding: 0 | 1 | 2;
  /** Undercuts the lowest sibling's homes tax by this many bp (Poacher), or 0. */
  undercut: number;
  /** Tries the WP3 county moves (links, contracts, adverts) it plays by. */
  county: 'none' | 'cooperate' | 'poach';
  /** Never opens new parcels (the Lab's land-limited towns, G2b). */
  noParcels?: boolean;
}

export interface BotDef {
  id: BotId;
  label: string;
  /** The seat's profile: child seats get the child standing-order defaults and 50 bp dials. */
  profile: 'kid' | 'adult';
  sessions: SessionModel;
  /** Plays during the Founding Fortnight too (between sprint taps). */
  sprintPlay: boolean;
  style: Style;
  policy: Policy;
}

// ---- The session context -------------------------------------------------------------------------

interface Ctx {
  v: BotView;
  t: TownState;
  p: Params;
  m: TownMap;
  s: Style;
  rng: BotRng;
  cmds: Command[];
  /** £ still spendable this session. */
  spend: number;
  /** Actions (commands) left. */
  left: number;
  seq: number;
  lastPlan: string | null;
}

const monthlySpend = (t: TownState): number => Math.max(5_000, t.civicMemo?.spending ?? 0);
const monthlyRevenue = (t: TownState): number => Math.max(0, t.civicMemo?.revenue ?? 0);

function newCtx(v: BotView, rng: BotRng, s: Style, actions: number, lens = true): Ctx {
  const t = v.town;
  const keep = s.keepMonths * monthlySpend(t);
  const m = mapOf(t);
  if (lens && t.buildings.length > 1) m.lens = lensOf(t, v.townIndex, v.env, v.now);
  return { v, t, p: v.params, m, s, rng, cmds: [], spend: Math.max(0, t.money.reserves - keep), left: actions, seq: 0, lastPlan: null };
}

const id = (c: Ctx, tag: string) => `${c.v.seat}:${c.v.now}:${c.seq++}:${tag}`;

/** Queues a build plan (split into chunks the move API accepts) if the session can afford it. */
function build(c: Ctx, ops: Op[], cost: number, tag: string): boolean {
  if (ops.length === 0 || c.left <= 0 || cost > c.spend) return false;
  const max = c.p.build.maxOps;
  for (let k = 0; k < ops.length; k += max) {
    const planId = id(c, tag);
    c.cmds.push({ type: 'build', planId, plan: ops.slice(k, k + max) });
    c.lastPlan = planId;
  }
  c.spend -= cost;
  c.left -= 1;
  return true;
}

function push(c: Ctx, cmd: Command): void {
  if (c.left <= 0) return;
  c.cmds.push(cmd);
  c.left -= 1;
}

const unlocked = (t: TownState, bid: string): boolean => {
  const def = BUILDINGS[buildingIndex(bid)];
  return !!def && t.tier >= def.tier && !def.free && !(def.unique && t.buildings.some((b) => BUILDINGS[b[0]]?.id === bid));
};

const ESSENTIAL_GROUPS = new Set(['power', 'water', 'police', 'fire', 'health', 'civic']);

/** Places one catalogue item at the best site for its goal. */
function place(c: Ctx, bid: string, goal: SiteGoal, tag = bid): boolean {
  if (!unlocked(c.t, bid)) return false;
  const def = BUILDINGS[buildingIndex(bid)];
  if (c.t.money.helper && !ESSENTIAL_GROUPS.has(def.group)) return false;
  const cost = placeCostOf(c.t, bid, c.p);
  if (cost > c.spend || c.left <= 0) return false;
  const site = findSite(c.m, bid, goal);
  if (!site) return false;
  claimSite(c.m, bid, site);
  lensAdd(c.m, bid, site);
  return build(c, [{ op: 'place', id: bid, x: site.x, y: site.y, rot: site.rot }], cost, bid);
}

// ---- Roads and zones -------------------------------------------------------------------------------

const roadKind = (t: TownState) => (t.tier >= 1 ? 'street' : 'lane') as 'street' | 'lane';

/** Zones `n` lots of `zone`, growing roads first when free lots run short. */
function zone(c: Ctx, z: number, n: number, score?: (i: number) => number): number {
  if (n <= 0 || c.left <= 0) return 0;
  const def = ZONE_DEFS[z];
  if (c.t.tier < def.unlock || c.t.tier > def.zoneUntil) return 0;
  const ops: Op[] = [];
  let cost = 0;
  const free = zoneCounts(c.m).freeLots;
  if (free < n + 4) {
    const kind = roadKind(c.t);
    const want = Math.ceil((n + 4 - free) / 3) + 2;
    const g = growRoads(c.m, Math.min(40, want), kind, c.spend * 0.8, c.p);
    if (g.tiles.length) {
      ops.push(...roadOps(g.tiles, kind));
      cost += g.cost;
    }
  }
  const lots = pickLots(c.m, z, n, score);
  if (lots.length === 0 && ops.length === 0) return 0;
  ops.push(...zoneOps(lots, ZONES[z]));
  cost += lots.length * c.p.build.zonePerTile;
  return build(c, ops, cost, `zone-${ZONES[z]}`) ? lots.length : 0;
}

/** Monthly construction starts the Builders cap allows (§5.2). */
const builders = (c: Ctx) => c.p.develop.buildersBase + c.v.pop / c.p.develop.buildersPer;

/** Workers without a job (the town's own people numbers, §5.9), as a share of the workforce. */
function unemployment(t: TownState): { rate: number; count: number } {
  const pm = t.peopleMemo;
  if (!pm) return { rate: 0, count: 0 };
  let u = 0;
  let jobs = 0;
  for (let h = 0; h < 3; h++) {
    u += pm.unemployed[h] ?? 0;
    jobs += pm.jobs[h] ?? 0;
  }
  return { rate: u / Math.max(1, u + jobs), count: u };
}

/** Jobs for the jobless (the Town and City checklists want unemployment at most 10%): shops or industry, whichever is wanted more. */
function jobs(c: Ctx): void {
  const u = unemployment(c.t);
  if (u.rate <= 0.06 || u.count < 10) return;
  const z = c.t.meters[5] * c.s.zoneMix[Z_INDUSTRY] > c.t.meters[3] * c.s.zoneMix[Z_SHOPS] ? Z_INDUSTRY : Z_SHOPS;
  const perLot = z === Z_INDUSTRY ? 10 : 6;
  zone(c, z, Math.min(30, Math.ceil(u.count / perLot)));
}

/** Meter-driven zoning: keep a few months of starts in stock for every zone whose meter is high. */
function zoneByMeters(c: Ctx): void {
  const counts = zoneCounts(c.m);
  const B = builders(c);
  const meterOf = (z: number) => (z === Z_HOMES ? Math.max(c.t.meters[0], c.t.meters[1], c.t.meters[2]) : c.t.meters[[-1, 3, 4, 5, 6, 7][z]]);
  const order = [Z_HOMES, Z_SHOPS, Z_INDUSTRY, Z_FARMS, Z_OFFICES, Z_LEISURE];
  // Strongest meter first, so a short session buys what is wanted most.
  order.sort((a, b) => meterOf(b) * c.s.zoneMix[b] - meterOf(a) * c.s.zoneMix[a] || a - b);
  for (const z of order) {
    if (c.left <= 0) return;
    const meter = meterOf(z);
    const mix = c.s.zoneMix[z];
    if (mix <= 0 || meter <= c.s.meterAt) continue;
    const stock = Math.ceil(B * 3 * (meter / 100) * mix) + 2;
    const n = Math.min(40, stock - counts.emptyLots[z]);
    if (n > 0) zone(c, z, n);
  }
}

// ---- Utilities -------------------------------------------------------------------------------------------

interface PlantOption {
  id: string;
  kind: 'power' | 'water';
  amount: number;
  dirty: boolean;
  clean: boolean;
}

const PLANTS: PlantOption[] = [
  { id: 'windmill', kind: 'power', amount: 300, dirty: false, clean: true },
  { id: 'generator', kind: 'power', amount: 600, dirty: true, clean: false },
  { id: 'windTurbine', kind: 'power', amount: 1500, dirty: false, clean: true },
  { id: 'solarFarm', kind: 'power', amount: 8000, dirty: false, clean: true },
  { id: 'gasPlant', kind: 'power', amount: 20000, dirty: false, clean: false },
  { id: 'coalPlant', kind: 'power', amount: 20000, dirty: true, clean: false },
  { id: 'well', kind: 'water', amount: 300, dirty: false, clean: true },
  { id: 'waterTower', kind: 'water', amount: 3000, dirty: false, clean: true },
  { id: 'pumpingStation', kind: 'water', amount: 25000, dirty: false, clean: true },
  { id: 'waterWorks', kind: 'water', amount: 100000, dirty: false, clean: true },
];

/** The plant that closes `gap` at the lowest two-year cost, by the style's taste (coal for the dirty, wind and sun for the clean). */
function choosePlant(c: Ctx, kind: 'power' | 'water', gap: number): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const o of PLANTS) {
    if (o.kind !== kind || !unlocked(c.t, o.id)) continue;
    if (o.id === 'coalPlant' && c.t.policies.some((q) => q.card === 'greenEnergyPledge')) continue;
    const def = BUILDINGS[buildingIndex(o.id)];
    const cost = placeCostOf(c.t, o.id, c.p);
    if (cost > c.spend) continue;
    const useful = Math.min(o.amount, gap * 1.5);
    let score = (cost + 24 * def.upkeep) / Math.max(1, useful);
    if (c.s.power === 'dirty' && o.dirty) score *= 0.6;
    if (c.s.power === 'clean' && !o.clean) score *= 1.8;
    if (c.s.power === 'cheap' && o.id === 'coalPlant') score *= 1.25;
    if (score < bestScore) {
      bestScore = score;
      best = o.id;
    }
  }
  return best;
}

/** Keeps power and water ahead of demand (§3.5): at most two plants a session. */
function utilities(c: Ctx, force = false): void {
  for (let k = 0; k < 2 && c.left > 0; k++) {
    // A hamlet's cottages develop without power or water (§3.5): plan for what stands, not the next level, until the purse can afford it.
    const u = utilityBalance(c.m, c.p, c.t.tier > 0 || c.t.money.reserves > 150_000);
    const margin = force ? 1.3 : 1.15;
    const pGap = u.powerNeed * margin + 40 - u.powerSupply;
    const wGap = u.waterNeed * margin + 40 - u.waterSupply;
    if (pGap <= 0 && wGap <= 0) return;
    const kind = pGap > 0 && (wGap <= 0 || pGap / Math.max(1, u.powerNeed) >= wGap / Math.max(1, u.waterNeed)) ? 'power' : 'water';
    const gap = kind === 'power' ? pGap : wGap;
    const pick = choosePlant(c, kind, gap);
    if (!pick || !place(c, pick, { kind: 'edge' })) return;
  }
}

// ---- Services ----------------------------------------------------------------------------------------------

/** The bigger of two buildings once the town has outgrown the smaller. */
function sized(t: TownState, pop: number, small: string, big: string, at: number): string {
  return unlocked(t, big) && pop >= at ? big : small;
}

const childrenOf = (t: TownState) => t.people[6] + t.people[7] + t.people[8];

function seatsOf(t: TownState, groups: string[]): number {
  let s = 0;
  for (const b of t.buildings) {
    const def = BUILDINGS[b[0]];
    if (def && groups.includes(def.group)) s += def.seats ?? 0;
  }
  return s;
}

function capacityOf(t: TownState, group: string): number {
  let s = 0;
  for (const b of t.buildings) {
    const def = BUILDINGS[b[0]];
    if (def && def.group === group) s += def.capacity ?? 0;
  }
  return s;
}

/** Population of the next tier (§7), for the readiness push before a promotion. */
const NEXT_POP = [300, 2000, 15000, 80000, Infinity];

/** A town within reach of its next tier keeps every checklist service with headroom, so one bad month cannot break the two-day hold. */
const readiness = (c: Ctx) => (c.v.pop >= 0.6 * NEXT_POP[c.t.tier] ? 1.15 : 1);

/** One service, kept at its target coverage of homes and capacity. Returns true if it built. */
function service(c: Ctx, what: 'police' | 'fire' | 'health' | 'park' | 'primary' | 'secondary' | 'fun' | 'culture' | 'transit', boost = 1): boolean {
  const t = c.t;
  const pop = c.v.pop;
  const k = boost * readiness(c);
  const target = Math.min(0.95, 0.82 * c.s.services * k);
  const need = pop * 1.2 * c.s.services * k;
  switch (what) {
    case 'police': {
      if (t.tier < 1) return false;
      const bid = sized(t, pop, 'constablePost', 'policeStation', 2500);
      if (coverageShare(c.m, 'police') < target || capacityOf(t, 'police') < need) return place(c, bid, { kind: 'cover', cover: 'police' });
      return false;
    }
    case 'fire': {
      if (t.tier < 1) return false;
      const bid = sized(t, pop, 'fireVolunteers', 'fireStation', 1500);
      if (coverageShare(c.m, 'fire') < target || capacityOf(t, 'fire') < need) return place(c, bid, { kind: 'cover', cover: 'fire' });
      return false;
    }
    case 'health': {
      if (t.tier < 1) return false;
      const bid = sized(t, pop, 'surgery', 'healthCentre', 3000);
      if (coverageShare(c.m, 'health') < target || capacityOf(t, 'health') < need) return place(c, bid, { kind: 'cover', cover: 'health' });
      return false;
    }
    case 'park': {
      const bid = t.tier >= 1 ? 'park' : c.rng() < 0.5 ? 'villageGreen' : 'pocketPark';
      const share = Math.max(coverageShare(c.m, 'nature'), coverageShare(c.m, 'fun'));
      if (share < Math.min(0.95, target * c.s.parks)) return place(c, bid, { kind: 'cover', cover: 'nature' });
      return false;
    }
    case 'primary': {
      const kids = childrenOf(t);
      const seats = seatsOf(t, ['primary']);
      if (seats >= kids * 1.1 * c.s.services * k && seats > 0) return false;
      const bid = t.tier >= 2 ? 'primarySchool' : t.tier >= 1 ? 'villageSchool' : 'schoolHouse';
      return place(c, bid, { kind: 'cover', cover: 'school' }) || place(c, bid, { kind: 'central' });
    }
    case 'secondary': {
      if (t.tier < 2) return false;
      const seats = seatsOf(t, ['secondary']);
      if (seats >= childrenOf(t) * 0.45 * c.s.services * k && seats > 0) return false;
      return place(c, 'secondarySchool', { kind: 'cover', cover: 'school' }) || place(c, 'secondarySchool', { kind: 'central' });
    }
    case 'fun': {
      if (t.tier < 1) return false;
      const bid = t.tier >= 2 && pop > 4000 ? (unlocked(t, 'sportsPitches') ? 'sportsPitches' : 'playground') : 'playground';
      if (coverageShare(c.m, 'fun') < target) return place(c, bid, { kind: 'cover', cover: 'fun' });
      return false;
    }
    case 'culture': {
      const n = buildingCounts(t);
      if (t.tier >= 1 && !n.communityHall) return place(c, 'communityHall', { kind: 'central' });
      if (t.tier >= 2 && !n.library) return place(c, 'library', { kind: 'central' });
      if (t.tier >= 2 && !n.museum && (c.s.tourism || pop > 8000)) return place(c, 'museum', { kind: 'central' });
      if (t.tier >= 3 && !n.theatre && (c.s.tourism || pop > 30000)) return place(c, 'theatre', { kind: 'central' });
      return false;
    }
    case 'transit': {
      if (t.tier < 2) return false;
      const n = buildingCounts(t);
      if (!n.busDepot) return place(c, 'busDepot', { kind: 'central' });
      if (coverageShare(c.m, 'transit') < Math.max(0.45, target * 0.6)) return place(c, 'busStop', { kind: 'cover', cover: 'transit' });
      return false;
    }
  }
}

/** Attractions for the Tourist (and anyone with money to spare at the higher tiers). */
function attraction(c: Ctx): boolean {
  const t = c.t;
  const n = buildingCounts(t);
  const order: [string, SiteGoal][] = [
    ['viewpoint', { kind: 'central' }],
    ['botanicGarden', { kind: 'central' }],
    ['museum', { kind: 'central' }],
    ['cinema', { kind: 'central' }],
    ['swimmingPool', { kind: 'central' }],
    ['theatre', { kind: 'central' }],
    ['clockTower', { kind: 'central' }],
    ['grandPier', { kind: 'central' }],
    ['stadium', { kind: 'central' }],
    ['townLandmark', { kind: 'central' }],
  ];
  for (const [bid, goal] of order) if (!n[bid] && unlocked(t, bid) && place(c, bid, goal)) return true;
  return false;
}

/** The next tier's checklist (§7): each unmet item mapped to the move that meets it. */
function checklist(c: Ctx): void {
  for (const item of c.v.checklist) {
    if (item.met || c.left <= 0) continue;
    switch (item.id) {
      case 'water90':
      case 'power95':
        utilities(c, true);
        break;
      case 'market': {
        const shops = zoneCounts(c.m).zoned[Z_SHOPS];
        if (shops < 8) zone(c, Z_SHOPS, 8 - shops);
        break;
      }
      case 'school':
        if (!seatsOf(c.t, ['primary'])) service(c, 'primary', 2);
        break;
      case 'green70':
        service(c, 'park', 1.3);
        break;
      case 'surgery70':
        service(c, 'health', 1.3);
        break;
      case 'police50':
        service(c, 'police', 1.1);
        break;
      case 'fire70':
        service(c, 'fire', 1.3);
        break;
      case 'primary80':
        service(c, 'primary', 1.2);
        break;
      case 'secondary75':
        service(c, 'secondary', 1.2);
        break;
      case 'jobs90':
        zone(c, c.t.meters[5] > c.t.meters[3] ? Z_INDUSTRY : Z_SHOPS, 6);
        break;
      case 'healthCentre':
        place(c, 'healthCentre', { kind: 'cover', cover: 'health' }) || place(c, 'healthCentre', { kind: 'central' });
        break;
      case 'libraryMuseum':
        place(c, 'library', { kind: 'central' });
        break;
      case 'bus40':
        service(c, 'transit', 1);
        break;
      case 'safety60':
        service(c, 'police', 1.3) || place(c, 'youthClub', { kind: 'central' });
        break;
      case 'university':
        place(c, 'university', { kind: 'central' });
        break;
      case 'culture60':
      case 'culture75':
        service(c, 'culture') || attraction(c);
        break;
      case 'transit20':
        if (!buildingCounts(c.t).railStation) place(c, 'railStation', { kind: 'central' });
        else service(c, 'transit', 1.4);
        break;
      case 'landmarks2':
        place(c, 'clockTower', { kind: 'central' }) || place(c, 'grandPier', { kind: 'central' }) || place(c, 'townLandmark', { kind: 'central' });
        break;
      case 'pollution45':
        service(c, 'park', 1.5);
        break;
      case 'approval50':
      case 'approval55':
      case 'approval60':
        // A tax cut only when the books can carry it; otherwise jobs and parks do the work.
        if (monthlyRevenue(c.t) > monthlySpend(c.t) && c.t.money.reserves > 3 * monthlySpend(c.t)) taxNudge(c, -50);
        else service(c, 'park', 1.2);
        break;
    }
  }
}

// ---- Advisors ----------------------------------------------------------------------------------------------

/** What each advisor card's one button would have the mayor do (§9.7), as a bot action. */
function followAdvisor(c: Ctx, card: string): boolean {
  const before = c.cmds.length;
  switch (card) {
    case 'bramble.power':
    case 'bramble.brownout':
    case 'bramble.water':
      utilities(c, true);
      break;
    case 'mo.jobsWanted':
      zone(c, c.t.meters[5] > c.t.meters[3] ? Z_INDUSTRY : Z_SHOPS, 6);
      break;
    case 'mo.homesWanted':
    case 'mo.squeezed':
      zone(c, Z_HOMES, 8);
      break;
    case 'bramble.shops':
      zone(c, Z_SHOPS, 4);
      break;
    case 'bramble.farms':
      zone(c, Z_FARMS, 2);
      break;
    case 'bramble.offices':
      zone(c, Z_OFFICES, 4);
      break;
    case 'zia.hotels':
    case 'zia.leisure':
      zone(c, Z_LEISURE, 4);
      break;
    case 'penny.factoriesPay':
      zone(c, Z_INDUSTRY, 4);
      break;
    case 'mo.schools':
    case 'mo.primarySeats':
      service(c, 'primary', 1.3);
      break;
    case 'mo.secondarySeats':
      service(c, 'secondary', 1.3);
      break;
    case 'mo.health':
      service(c, 'health', 1.3);
      break;
    case 'mo.safety':
      service(c, 'police', 1.3);
      break;
    case 'zia.fun':
      service(c, 'fun', 1.3) || service(c, 'park', 1.3);
      break;
    case 'zia.nature':
    case 'bramble.pollution':
      service(c, 'park', 1.3);
      break;
    case 'zia.culture':
      service(c, 'culture');
      break;
    case 'zia.buzz':
    case 'zia.crowded':
    case 'zia.visitorsUnhappy':
      attraction(c);
      break;
    case 'bramble.traffic':
    case 'bramble.commutes':
      upgradeMain(c);
      break;
    case 'penny.reservesLow':
    case 'penny.deficit':
      taxNudge(c, 100);
      break;
    case 'penny.taxHigh':
    case 'mo.taxStar':
      taxNudge(c, -50);
      break;
    case 'mo.unhappy':
    case 'mo.approval':
      service(c, 'park', 1.2) || taxNudge(c, -50);
      break;
    default:
      break;
  }
  return c.cmds.length > before;
}

function upgradeMain(c: Ctx): void {
  if (c.t.tier < 2) return;
  const tiles = upgradeCandidates(c.m, 'avenue', 24);
  if (tiles.length === 0) return;
  let cost = 0;
  for (const i of tiles) cost += roadTileCost(c.m, 'avenue', i, c.p);
  build(c, roadOps(tiles, 'avenue').map((o) => ({ ...(o as Op & { op: 'road' }), op: 'upgrade' as const })), cost, 'avenue');
}

// ---- Taxes and money ---------------------------------------------------------------------------------------

/** The homes tax dial a session wants, from the style and the books. */
function wantedTax(c: Ctx): number {
  const t = c.t;
  let tax = c.s.homesTax;
  if (c.s.undercut > 0) {
    let low = Infinity;
    for (const o of c.v.others) if (o && !o.archived && !o.inFortnight) low = Math.min(low, Math.min(...o.taxes.homes));
    if (Number.isFinite(low)) tax = Math.min(tax, low - c.s.undercut);
  }
  const rev = monthlyRevenue(t);
  const spend = monthlySpend(t);
  const months = t.money.reserves / spend;
  // A tax rise costs approval, and approval is on every checklist: only when the purse is really short.
  if (t.tier > 0 && rev > 0 && rev < spend * 0.95 && months < 2 && t.approval > 60) tax += 100;
  if (rev > spend * 1.3 && months > 12) tax -= 50;
  return tax;
}

const snap = (bp: number, step: number) => Math.round(bp / step) * step;

/** Moves the homes tax dial by `delta` within the band (a move only if it changes). */
function taxNudge(c: Ctx, delta: number): void {
  setTax(c, currentHomes(c.t) + delta);
}

const currentHomes = (t: TownState) => Math.round((t.taxes.homes[0] + t.taxes.homes[1] + t.taxes.homes[2]) / 3);

function setTax(c: Ctx, bp: number): void {
  const t = c.t;
  const step = c.v.profile === 'kid' ? c.p.finance.kidStep : c.p.finance.adultStep;
  let v = snap(Math.max(c.s.taxBand[0], Math.min(c.s.taxBand[1], bp)), step);
  if (t.money.helper) v = Math.max(v, snap(t.money.helper.step >= 2 ? 1200 : 1000, step));
  if (v === currentHomes(t) && t.taxes.homes.every((h) => h === t.taxes.homes[0])) return;
  const taxes = t.tier === 0 ? { town: v } : { homes: v, business: snap(Math.min(1200, Math.max(t.money.helper ? 600 : 0, Math.round(v / 2))), step) };
  push(c, { type: 'budget', moveId: id(c, 'tax'), taxes });
}

function funding(c: Ctx): void {
  const want = c.s.funding;
  if (c.t.money.helper && want > 0) return;
  if (c.t.funding.every((f) => f === want)) return;
  const patch: Record<string, 0 | 1 | 2> = {};
  for (const g of Object.keys(FUNDING_GROUPS)) patch[g] = want;
  push(c, { type: 'budget', moveId: id(c, 'fund'), funding: patch });
}

function borrow(c: Ctx): void {
  const t = c.t;
  if (!c.s.borrow || t.money.helper) return;
  const rev = monthlyRevenue(t);
  if (t.tier >= 2 && !t.money.loan && rev > 0) {
    const take = Math.floor(c.p.finance.loanMultiple * rev);
    if (take > 0) {
      push(c, { type: 'loan', moveId: id(c, 'loan'), take });
      c.spend += take;
    }
  }
  if (t.tier >= 3 && t.money.bonds.length < 3 && rev > 0) {
    push(c, { type: 'bond', moveId: id(c, 'bond'), issue: { size: 12, years: 20 } });
    c.spend += 12 * rev;
  }
}

function parcels(c: Ctx): void {
  if (c.s.noParcels || c.t.parcelRights <= 0 || c.left <= 0) return;
  const q = bestParcel(c.t);
  if (q === null) return;
  build(c, [{ op: 'parcel', p: q }], c.p.build.surveyFee * Math.max(1, c.t.tier), 'parcel');
}

// ---- The county moves (WP3) ---------------------------------------------------------------------------------

/** Tries the moves this style plays by; until WP3 lands they are refused and the Lab counts the refusals. */
function countyMoves(c: Ctx): void {
  if (c.s.county === 'none' || c.t.tier < 1) return;
  let target = -1;
  let biggest = -1;
  c.v.others.forEach((o, i) => {
    if (o && !o.archived && !o.inFortnight && o.pop > biggest) {
      biggest = o.pop;
      target = i;
    }
  });
  if (target < 0) return;
  if (c.s.county === 'cooperate') push(c, { type: 'link', moveId: id(c, 'link'), propose: { to: target, kind: 'road', share: 0.5 } });
  else push(c, { type: 'advert', moveId: id(c, 'advert'), target, cohort: 1 });
}

// ---- The Founding Fortnight -----------------------------------------------------------------------------------

/**
 * Bramble's three steps (§1.5, A12) on the bot's lattice: a lane from the
 * County Road, 12 Homes lots beside it, 2 Farms and a Well. Same shape and
 * cost as the tutorial's, laid out so the bot's later roads join it.
 */
export function brambleCommands(v: BotView): Command[] {
  const c = newCtx(v, () => 0.5, STYLES.balanced, 3, false);
  c.spend = v.town.money.reserves;
  const g = growRoads(c.m, 10, 'lane', c.spend, c.p);
  build(c, roadOps(g.tiles, 'lane'), g.cost, 'bramble-lane');
  const homes = pickLots(c.m, Z_HOMES, 12, (i) => -dist(i));
  build(c, zoneOps(homes, 'homes'), 0, 'bramble-homes');
  const farms = pickLots(c.m, Z_FARMS, 2, (i) => -dist(i));
  const ops: Op[] = zoneOps(farms, 'farms');
  const well = findSite(c.m, 'well', { kind: 'edge' });
  if (well) ops.push({ op: 'place', id: 'well', x: well.x, y: well.y, rot: 0 });
  build(c, ops, placeCostOf(v.town, 'well', c.p), 'bramble-farms');
  return c.cmds;
}

/** Distance from the County Road's end (the tutorial paints beside the new lane). */
const dist = (i: number) => {
  const x = i % MAP;
  const y = (i - x) / MAP;
  return Math.abs(x - 32) + 1.5 * Math.abs(y - 44);
};

// ---- The policies ---------------------------------------------------------------------------------------------

/** The full session most styles share; the style's dials make the difference. */
function playSession(v: BotView, rng: BotRng, s: Style, actions: number): Command[] {
  const c = newCtx(v, rng, s, actions);
  setTax(c, wantedTax(c));
  funding(c);
  borrow(c);
  utilities(c);
  if (s.spamHomes) {
    for (let k = 0; k < 3 && c.left > 0; k++) zone(c, Z_HOMES, 40);
    return finish(c);
  }
  checklist(c);
  if (s.services > 0) jobs(c);
  // Advisors in rank order; the Kid follows only some of the time.
  for (const card of v.advisors) {
    if (c.left <= 0) break;
    if (rng() < s.advisorFollow) followAdvisor(c, card);
  }
  zoneByMeters(c);
  if (s.services > 0) {
    const order: Parameters<typeof service>[1][] = ['primary', 'park', 'health', 'police', 'fire', 'fun', 'culture', 'secondary', 'transit'];
    let placed = 0;
    for (const what of order) {
      if (c.left <= 0 || placed >= Math.max(1, Math.round(2 * s.services))) break;
      if (service(c, what)) placed++;
    }
  }
  if (s.tourism && v.town.tier >= 1) attraction(c);
  parcels(c);
  countyMoves(c);
  return finish(c);
}

function finish(c: Ctx): Command[] {
  if (c.s.undo > 0 && c.lastPlan && c.rng() < c.s.undo) c.cmds.push({ type: 'undo', moveId: id(c, 'undo'), planId: c.lastPlan });
  return c.cmds;
}

/** The Kid (§11.2): three actions a day, an advisor card 60% of the time, otherwise something random but legal. */
function kidPolicy(v: BotView, rng: BotRng, s: Style): Command[] {
  const c = newCtx(v, rng, s, 3);
  utilities(c);
  while (c.left > 0) {
    const before = c.left;
    if (rng() < s.advisorFollow && v.advisors.length > 0) followAdvisor(c, v.advisors[Math.floor(rng() * v.advisors.length)]);
    if (c.left === before) randomAction(c);
    if (c.left === before) c.left--; // nothing legal: the action is spent anyway
  }
  return finish(c);
}

/** Something random but legal, the way a child pokes at the Build menu (parks most of all). */
function randomAction(c: Ctx): void {
  const r = c.rng();
  // A child taps near the middle of the screen, not at the best lot.
  const wobble = (i: number) => c.rng() * 10 - Math.abs((i % MAP) - 32) * 0.2;
  if (r < 0.4) {
    const bid = c.t.tier >= 1 && c.rng() < 0.5 ? 'playground' : c.rng() < 0.5 ? 'villageGreen' : 'pocketPark';
    place(c, bid, { kind: 'central' });
  } else if (r < 0.7) zone(c, Z_HOMES, 3 + Math.floor(c.rng() * 4), wobble);
  else if (r < 0.85) zone(c, Z_SHOPS, 2 + Math.floor(c.rng() * 3), wobble);
  else if (r < 0.95) zone(c, Z_INDUSTRY, 2 + Math.floor(c.rng() * 3), wobble);
  else zone(c, Z_FARMS, 2, wobble);
}

const ALL = [1, 1, 1, 1, 1, 1];

const base: Style = {
  homesTax: 800,
  taxBand: [500, 1200],
  keepMonths: 2,
  services: 1,
  zoneMix: ALL,
  meterAt: 15,
  power: 'cheap',
  borrow: false,
  tourism: false,
  advisorFollow: 1,
  undo: 0,
  parks: 1,
  spamHomes: false,
  funding: 1,
  undercut: 0,
  county: 'none',
};

export const STYLES: Record<BotId, Style> = {
  balanced: base,
  tourist: { ...base, zoneMix: [1, 1.2, 2, 0.25, 0.8, 0.6], tourism: true, power: 'clean', parks: 1.3 },
  industrial: { ...base, zoneMix: [1, 0.8, 0.3, 2.2, 0.6, 1.2], power: 'dirty', services: 0.7, parks: 0.7 },
  suburb: { ...base, zoneMix: [1.6, 0.6, 0.4, 0.3, 0.3, 0.6], services: 1.2, parks: 1.4 },
  greedy: { ...base, homesTax: 1500, taxBand: [1400, 2000], services: 0, funding: 0, keepMonths: 3 },
  debt: { ...base, homesTax: 600, taxBand: [400, 800], borrow: true, services: 1.6, tourism: true, keepMonths: 0.25 },
  poacher: { ...base, undercut: 100, taxBand: [300, 1200], county: 'poach' },
  hermit: base,
  cooperator: { ...base, county: 'cooperate' },
  kid: { ...base, advisorFollow: 0.6, undo: 0.3, parks: 1.6, keepMonths: 0.5 },
  weekly: base,
  absent: base,
  spammer: { ...base, spamHomes: true, services: 0 },
};

const DAILY: SessionModel = { hours: [7.5, 16.5, 20], actions: 8 };

const SESSIONS: Record<BotId, SessionModel> = {
  balanced: DAILY,
  tourist: DAILY,
  industrial: DAILY,
  suburb: DAILY,
  greedy: DAILY,
  debt: DAILY,
  poacher: DAILY,
  hermit: DAILY,
  cooperator: DAILY,
  kid: { hours: [16.5], actions: 3, perDay: 3 },
  weekly: { hours: [10, 15, 19.5], actions: 24, sundaysOnly: true },
  absent: { hours: [], actions: 0 },
  spammer: DAILY,
};

/** Bot `id`'s policy played with `style` (the registry's own style, or a Lab override such as a fixed tax). */
export function stylePolicy(id: BotId, style: Style): Policy {
  if (id === 'absent') return () => [];
  if (id === 'kid') return (v, rng) => kidPolicy(v, rng, style);
  const actions = SESSIONS[id].actions;
  return (v, rng) => playSession(v, rng, style, actions);
}

function def(id: BotId, label: string, profile: 'kid' | 'adult' = 'adult', sprintPlay = true): BotDef {
  const style = STYLES[id];
  return { id, label, profile, sessions: SESSIONS[id], sprintPlay, style, policy: stylePolicy(id, style) };
}

/** The bot registry (§11.2 plus the Spammer of §5.22). */
export const BOTS: Record<BotId, BotDef> = {
  balanced: def('balanced', 'Balanced'),
  tourist: def('tourist', 'Tourist'),
  industrial: def('industrial', 'Industrial'),
  suburb: def('suburb', 'Suburb'),
  greedy: def('greedy', 'Greedy Taxer'),
  debt: def('debt', 'Debt Spender'),
  poacher: def('poacher', 'Poacher'),
  hermit: def('hermit', 'Hermit'),
  cooperator: def('cooperator', 'Cooperator'),
  kid: def('kid', 'Kid', 'kid', false),
  weekly: def('weekly', 'Weekly'),
  absent: def('absent', 'Absent', 'kid', false),
  spammer: def('spammer', 'Spammer'),
};

/** Resolves a bot name or alias. */
export function botById(name: string): BotDef {
  const key = (BOT_ALIASES[name] ?? name) as BotId;
  const b = BOTS[key];
  if (!b) throw new Error(`unknown bot ${name}`);
  return b;
}

