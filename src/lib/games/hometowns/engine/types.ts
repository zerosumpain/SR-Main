// The Hometowns contract (WP1's contract freeze, spec §13.1). Every work
// package codes against these shapes. State is JSON-safe: numbers, strings,
// booleans, null, plain objects and arrays only, no Map or Set, iterated by
// index. A package writes only the fields its work package owns (the OWNER
// notes below, from §13.2); everything else it reads is an input. A change to
// this file is a contract amendment: additive, reviewed by both sides, and
// noted in the PR.
//
// Index layouts are part of the contract, so they live here as constants.
// They are append-only: renumbering one would silently re-read every saved
// county.

import type { Params, ParamsVersion } from './params';
import type { StreamId } from './rand';

// ---- Identities and enums --------------------------------------------------------

export type SeatId = string;
export type Tier = 0 | 1 | 2 | 3 | 4;
export const TIER_NAMES = ['hamlet', 'village', 'town', 'city', 'metropolis'] as const;
export type TierName = (typeof TIER_NAMES)[number];

/** Wealth (= skill) tiers h: £ Modest, ££ Comfortable, £££ Well-off. */
export const WEALTH = ['modest', 'comfortable', 'welloff'] as const;
export const H_L = 0;
export const H_M = 1;
export const H_H = 2;

/** Life stages of the person stocks. */
export const STAGE_W = 0; // Workers
export const STAGE_P = 1; // Parents
export const STAGE_C = 2; // Children
export const STAGE_R = 3; // Retirees
/** The 13 person stocks: people[stage·3 + h], then Students at 12. */
export const PERSON_S = 12;
export const PEOPLE_COUNT = 13;
export const person = (stage: number, h: number): number => stage * 3 + h;

/**
 * The 10 migration cohorts k (§5.11): cohort(h, kind) = h·3 + kind, with kind
 * 0 Workers, 1 Families (Parents with their Children), 2 Retirees; Students 9.
 * applicants[], happy[] and the migration weights all use this order.
 */
export const COHORTS = ['wL', 'fL', 'rL', 'wM', 'fM', 'rM', 'wH', 'fH', 'rH', 's'] as const;
export const COHORT_COUNT = 10;
export const COHORT_S = 9;
export const cohort = (h: number, kind: 0 | 1 | 2): number => h * 3 + kind;

/**
 * Stars (§5.6), 0–100. perceived[] and the stars slot use STAR_COUNT = 20
 * entries: the 11 town stars (Jobs, Homes and Tax as population-weighted
 * means), then Jobs, Homes and Tax per tier at STAR_TIER + 3·s + h.
 */
export const STARS = ['jobs', 'homes', 'tax', 'schools', 'health', 'safety', 'fun', 'culture', 'nature', 'around', 'buzz'] as const;
export type StarKey = (typeof STARS)[number];
export const STAR_TOWN = 11;
export const STAR_TIER = 11;
export const STAR_COUNT = 20;
export const starTier = (s: 0 | 1 | 2, h: number): number => STAR_TIER + 3 * s + h;

/** Demand meters, −100..+100 (§5.8, §5.12). */
export const METERS = ['homesL', 'homesM', 'homesH', 'shops', 'leisure', 'industry', 'offices', 'farms'] as const;
export type MeterKey = (typeof METERS)[number];
export const METER_SHOPS = 3;
export const METER_LEISURE = 4;
export const METER_INDUSTRY = 5;
export const METER_OFFICES = 6;
export const METER_FARMS = 7;

/** Zones painted on tiles (the `use` plane's zone payload). */
export const ZONES = ['homes', 'shops', 'leisure', 'industry', 'offices', 'farms'] as const;
export type ZoneKind = (typeof ZONES)[number];
export const Z_HOMES = 0;
export const Z_SHOPS = 1;
export const Z_LEISURE = 2;
export const Z_INDUSTRY = 3;
export const Z_OFFICES = 4;
export const Z_FARMS = 5;
/** The meter each non-Homes zone feeds (Homes uses METER h). */
export const ZONE_METER: readonly number[] = [-1, METER_SHOPS, METER_LEISURE, METER_INDUSTRY, METER_OFFICES, METER_FARMS];

/** Firm sectors, in the fixed matching order of A3: Farms, Industry, Shops, Leisure, Offices. */
export const SECTORS = ['farms', 'industry', 'shops', 'leisure', 'offices'] as const;
export const SECTOR_COUNT = 5;
/** Zone index → sector index (-1 for Homes). */
export const ZONE_SECTOR: readonly number[] = [-1, 2, 3, 1, 4, 0];
/** margins[] holds m̄ (reported) at SECTOR index and m̄′ (supply-line) at SECTOR_COUNT + index. */
export const MARGIN_PRIME = 5;

export const ROAD_KINDS = ['lane', 'street', 'avenue', 'county'] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];
/** The kinds a player may draw (the County Road is built in at founding). */
export type DrawnRoad = 'lane' | 'street' | 'avenue' | 'rail';

/** Funding is an enum per service (A25). */
export const FUND_LOW = 0;
export const FUND_NORMAL = 1;
export const FUND_HIGH = 2;
export type Funding = 0 | 1 | 2;
export const FUNDING_KEYS = ['police', 'fire', 'health', 'education', 'fun', 'culture', 'transit', 'roads', 'utilities'] as const;
export type FundingKey = (typeof FUNDING_KEYS)[number];
/** The Hamlet dials' three groups (§7): Safety, Learning & Health, Fun & Parks. */
export const FUNDING_GROUPS: Record<'safety' | 'learning' | 'fun', readonly FundingKey[]> = {
  safety: ['police', 'fire'],
  learning: ['health', 'education'],
  fun: ['fun', 'culture'],
};

/** Coverage kinds (§5.4). */
export const COVERAGES = ['police', 'fire', 'health', 'school', 'fun', 'culture', 'nature', 'transit'] as const;
export type CoverageKind = (typeof COVERAGES)[number];

export const SITE_KINDS = ['river', 'coast', 'hills', 'forest', 'flatland'] as const;
export type SiteKind = (typeof SITE_KINDS)[number];

export const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B'] as const;

/** The five faces children see (§4.2). */
export const FACES = ['workers', 'professionals', 'families', 'retirees', 'students'] as const;

/**
 * Ledger lines (£), used by Books and the Why money terms. Revenue lines are
 * positive postings, spending lines negative. WP2d owns their meaning; any
 * package that moves money posts to a line through `postMoney` (core.ts).
 */
export const LEDGER_LINES = [
  // revenue
  'homesTax', 'businessTax', 'salesTax', 'hotelTax', 'fares', 'utilitySales', 'contractIncome', 'sharedFees',
  'dealLeases', 'commuterRule', 'fundGrant', 'aid', 'giftCoins', 'greatWorkRebate', 'tuition', 'helperAdvance',
  'borrowing', 'helperWriteOff',
  // spending
  'upkeepCivic', 'upkeepRoads', 'upkeepUtilities', 'utilityImports', 'loanService', 'bondService', 'interest',
  'contractPayments', 'penalties', 'greatWorkPledge', 'fundContribution', 'helperRepay', 'policyCosts', 'repairs',
  'capital', 'surveyFees', 'refunds', 'repayment',
  // anything else, so a posting is never refused
  'other',
] as const;
export type LedgerLine = (typeof LEDGER_LINES)[number];

/** Population flows (persons) used by Books: every change of a town's head-count posts to one. */
export const POP_FLOWS = ['births', 'deaths', 'arrivals', 'leavers', 'playersIn', 'playersOut', 'carts', 'other'] as const;
export type PopFlow = (typeof POP_FLOWS)[number];

export type WorkPackage = 'WP1' | 'WP2a' | 'WP2b' | 'WP2c' | 'WP2d' | 'WP2e' | 'WP3' | 'WP4' | 'WP5' | 'WP6';

/** Thrown for a refused move or a bad call; shape-compatible with the framework's GameError. */
export class EngineError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
    /** A19: the store should retry after a second (a Regional Day is finishing). */
    readonly retry = false,
  ) {
    super(message);
  }
}

// ---- The County ---------------------------------------------------------------------

export interface CountySettings {
  rivalry: 'friendly' | 'spirited';
  mishaps: 'mild' | 'off';
  /** Seats youngest first (tie-breaks that favour the youngest mayor). */
  youngestOrder: SeatId[];
  perSeat: Record<SeatId, SeatSettings>;
}

export interface SeatSettings {
  profile: 'kid' | 'adult';
  /** Pushes enabled by a parent (children default off, §9.12). */
  pushes: boolean;
  pranks: boolean;
  /** A parent may limit a child to answering contracts (§10.6). */
  answerOnly: boolean;
  /** Kids' assists change only the starting grant and advisor tone (§11.5). */
  assist: 'none' | 'gentle';
}

export interface Site {
  index: number;
  kind: SiteKind;
  terrainSeed: number;
  owner: SeatId | null;
}

export interface KingsportState {
  pop: number;
  stars: number[];
  /**
   * Outside money paid into towns (Helper Mode advances, write-offs, pensions
   * are not counted). Tracked so money conservation across the county is
   * checkable: Σ town reserves changes = transfers in from Kingsport − out.
   */
  treasuryOut: number;
}

/** OWNER WP3: everything on CountyState except the clock fields (WP1). */
export interface CountyState {
  name: string;
  seed: number;
  paramsVersion: ParamsVersion;
  tz: 'Europe/London';
  regionalHour: number;
  /** Local dev clock only (§2.6): null in production. */
  devTickMs: number | null;
  // -- clock (WP1) --
  epoch: number;
  tickMs: number;
  pausedMs: number;
  pause: { since: number } | null;
  pauseUsedMs: number;
  nap: { since: number } | null;
  lastHelloAt: number;
  /** The county grid tick reached by the last completed catch-up. */
  gridTick: number;
  /** Regional Days run so far; the next one has this index. */
  dayIndex: number;
  lastRegionalDayAt: number;
  /** Regional Day instants before this are skipped (they fell in a pause or nap, A22). */
  resumedAt: number;
  // -- county (WP3) --
  season: { n: number; theme: string; startedDay: number; startMonth: number; menu: string[] };
  settings: CountySettings;
  parents: SeatId[];
  sites: Site[];
  /** Index = seat order; iterate by index only. */
  towns: TownState[];
  kingsport: KingsportState;
  /** Frozen at the last Regional Day; the only thing towns read of each other. */
  snapshot: Snapshot;
  /** Migration intents [i][j][k] flattened (i·T + j)·10 + k over towns T, persons as doubles (A25). */
  ledger: number[];
  links: Link[];
  offers: Offer[];
  contracts: Contract[];
  pacts: Pact[];
  market: { goods: Market; food: Market };
  /** Today's fixed goods and food flows. */
  allocations: Allocation[];
  flows: DayFlows;
  greatWork: GreatWorkState | null;
  goals: GoalsBoard;
  council: CouncilState;
  awards: AwardsState;
  fund: number;
  festival: FestivalState | null;
  gazette: GazetteIssue[];
  /** Per seat index, the last 3 bulletins. */
  bulletin: BulletinItem[][];
  /** Distinct contact weeks per pair (i·6 + j). */
  friendship: number[];
  /** The command log (ring of 150): audit, idempotency (A28) and the undo window. */
  log: CommandRecord[];
  /** Engine alerts (a reverted month, a refused Regional Day), ring of 20. */
  alerts: AlertRecord[];
  /**
   * WP3 addition: the county layer's own memory (region-state.ts creates it
   * on first use; absent on a county no WP3 Regional Day or move has touched).
   */
  region?: RegionState;
}

export interface Link {
  id: string;
  kind: 'road' | 'bus' | 'rail';
  a: number;
  b: number;
  state: 'proposed' | 'waiting' | 'open' | 'closing';
  proposedDay: number;
  openedDay: number | null;
  closeDay: number | null;
  /** £ paid by each side. */
  paid: [number, number];
  /** Minutes link time (25 neighbour, 50 via Kingsport, 12/24 rail). */
  minutes: number;
}

export interface Offer {
  id: string;
  kind: 'link' | 'contract' | 'share' | 'pact' | 'deal' | 'ribbon';
  from: number;
  to: number;
  body: Record<string, unknown>;
  madeDay: number;
  expiresDay: number;
}

export interface Contract {
  id: string;
  kind: 'power' | 'water' | 'freight';
  seller: number;
  buyer: number;
  /** Units per month. */
  amount: number;
  /** £ per unit. */
  price: number;
  startDay: number;
  endDay: number | null;
  renew: boolean;
  /** WP3 addition: a mayor ended it (§8.7), so it is never renewed, whatever the standing orders say. */
  ended?: boolean;
}

export interface Pact {
  id: string;
  kind: 'trail' | 'twin';
  a: number;
  b: number;
  sinceDay: number;
  /** WP3 addition: the dayIndex a notice to dissolve takes effect (a week's notice, §8.7), or absent. */
  endDay?: number | null;
}

export interface Market {
  /** County price index (1.0 = £1,000 a goods unit, £60 a food unit). */
  p: number;
  supply: number;
  demand: number;
}

export interface Allocation {
  good: 'goods' | 'food';
  seller: number;
  buyer: number;
  /** Units per month for the coming day. */
  units: number;
  /** £ per unit landed (county price minus shipping). */
  price: number;
}

/** OWNER WP3: tomorrow's fixed flows per town (index = town index). WP2b/c read them. */
export interface DayFlows {
  towns: TownDayFlows[];
}

export interface TownDayFlows {
  /** In-commuter allowance per month by tier (fills vacancies, §5.9 step 3). */
  commutersIn: number[];
  /** Out-commuter allowance per month by tier. */
  commutersOut: number[];
  /** £ per month linked towns' shoppers spend here. */
  shoppersIn: number;
  /** Share of residents' retail spend that leaks to linked towns (≤ 0.25). */
  leak: number;
  /** Day trips per month into this town. */
  dayTripsIn: number;
  /** Share of the county tourist pool, and the pool itself (visitors/month). */
  touristShare: number;
  touristPool: number;
  /** Shared places received (hospital beds, university places). */
  sharedHealth: number;
  sharedUniversity: number;
  /** Shared-air emissions entering the facing edge (Spirited only). */
  airIn: number;
  /** A20: advert utility bonus per cohort for this town's movers, from yesterday's adverts. */
  advert: number[];
  /** Buzz from stamps and attendance (A20: arrives a day late). */
  buzz: number;
  /**
   * WP3 addition: per COHORT, the towns whose adverts the bonus in
   * `advert[k]` is for, as a bit mask (bit j: town index j; 0: none). An
   * advert's +0.25 utility applies only to this town's movers choosing one of
   * those advertisers (§8.6). Several towns may advertise to the same cohort
   * at once and each gets its bonus, so no fee is paid for nothing and the
   * order moves arrived in cannot matter. Absent: no adverts.
   */
  advertBy?: number[];
}

export interface GreatWorkState {
  id: string;
  stage: number;
  /** Progress per input kind for the current stage. */
  progress: number[];
  /** Credit per town index. */
  credit: number[];
  pledges: { town: number; input: string; amount: number; day: number }[];
}

export interface GoalsBoard {
  week: number;
  goals: { key: string; target: number; progress: number }[];
}

export interface CouncilState {
  question: string | null;
  options: string[];
  /** Vote per town index, or null. */
  votes: (number | null)[];
  closesDay: number | null;
  results: { question: string; choice: number; day: number }[];
}

export interface AwardsState {
  week: number;
  history: { town: number; award: string; week: number }[];
  /** Weeks since each town index last won anything (the Mention guarantee). */
  dry: number[];
}

export interface FestivalState {
  host: number;
  day: number;
  kind: string;
}

export interface GazetteIssue {
  day: number;
  week: number;
  items: { key: string; data: Record<string, number | string> }[];
}

export interface BulletinItem {
  key: string;
  data: Record<string, number | string>;
}

// ---- WP3 addition: the county layer's memory (region-state.ts) -------------------------
//
// Everything here is written only at the Regional Day or by a WP3 move on
// county state (A20: no town reads it during the day). Arrays indexed by
// town index grow when a town is founded; pair arrays use (i·6 + j).

/** A cross-town effect waiting for the next Regional Day (A20). */
export interface Delivery {
  id: string;
  kind: 'gift' | 'aid' | 'advert' | 'prank' | 'prankReply' | 'stamp' | 'attend';
  from: number;
  to: number;
  /** The dayIndex of the move. */
  day: number;
  /** Gift item, aid kind, prank kind, sticker, reply choice, or an advert's target cohort. */
  item: string;
  /** £ held in escrow for it (gift and aid coins, an advert's fee) or goods units sent as aid, else 0. */
  amount: number;
}

/** A settled pair flow of players' people (§8.4 item 4). */
export interface MoveStory {
  day: number;
  from: number;
  to: number;
  /** COHORT index and persons moved. */
  cohort: number;
  n: number;
  /** The top 2 reasons, STARS keys (or 'needs'), with their utility gaps w·(Ī_j − Ī_i). */
  reasons: string[];
  gaps: number[];
  /** The losing town's best relative strength for this cohort, and a suggested action key. */
  strength: string | null;
  action: string;
}

/** A shared-places agreement (§8.7 item 4, City+). */
export interface ShareDeal {
  id: string;
  service: 'health' | 'university';
  provider: number;
  user: number;
  places: number;
  /** £ per patient- or student-month. */
  price: number;
  startDay: number;
  endDay: number | null;
  /**
   * Places a month the user actually had of this agreement tomorrow, fixed
   * at step 4 (its share of the user's capped total); the fee at the next
   * step 2 is charged on this. Absent: none yet (it has not started).
   */
  used?: number;
}

/** An advert campaign in force (§8.6): the advertiser, its target town and cohort, and the last day it runs. */
export interface Campaign {
  from: number;
  to: number;
  cohort: number;
  untilDay: number;
}

/** One town's County Week accumulators: sums of daily samples since the last County Week. */
export interface WeekTown {
  days: number;
  /** Days on holiday (no award points, §2.4). */
  holidayDays: number;
  mood: number;
  happy: number;
  pollution: number;
  safety: number;
  rep: number;
  around: number;
  /** Day revenue and spending (£), for the surplus share. */
  revenue: number;
  spending: number;
  /** Kind acts (gifts, aid, stamps, attendance, pledges) sent. */
  kind: number;
  visitors: number;
  /** First and latest samples of population, culture and mood. */
  pop0: number;
  pop1: number;
  culture0: number;
  culture1: number;
  mood0: number;
  mood1: number;
}

export interface RegionState {
  /** £ paid by senders at their move and not yet delivered, refunded or paid to Kingsport (escrow). */
  held: number;
  outbox: Delivery[];
  /** Per town index: the town tick at the last Regional Day (months in the day, §2.2). */
  lastTick: number[];
  /** Per town index: net persons lost to players at each of the last 7 Regional Days, oldest first. */
  lossDays: number[][];
  /** Per town index: population at each of the last 7 Regional Days, oldest first. */
  popDays: number[][];
  /** Today's commuters per month, C[(home·T + work)·3 + h], kept to attribute the commuter rule tomorrow. */
  commute: number[];
  /** MoveStories of the last Regional Day, and of the week (the Gazette, capped). */
  stories: MoveStory[];
  weekStories: MoveStory[];
  shares: ShareDeal[];
  campaigns: Campaign[];
  /** Council outcomes in force (§8.9). */
  commuterRule: number;
  cleanAir: boolean;
  countyTrail: boolean;
  festivalTheme: string;
  flag: number;
  nextTheme: string | null;
  /** The Great Work the Council chose (M3 seam: greatworks.ts builds it). */
  greatWorkChoice: string | null;
  /** A22: County Weeks run this season, and the London day number of the last one (−1: none yet). */
  seasonWeek: number;
  lastWeekDay: number;
  week: WeekTown[];
  /** Per pair (from·6 + to): adverts and pranks sent this County Week. */
  adverts: number[];
  pranks: number[];
  /** Per pair (i·6 + j, both orders): contact this County Week (friendship weeks). */
  contact: number[];
  /** Festival bids this week: town index → bid kind ('' = none). */
  bids: string[];
  /** A33: archived town indices already settled, and those whose mayor was erased (erase-mayor.ts). */
  settled: number[];
  erased: number[];
  /**
   * Per town index: the next serial number for the ids of its offers, links
   * and deliveries and of the items in its inbox. Ids never carry a move's
   * client id (free text another town would see), and never repeat.
   */
  seq: number[];
  /** Per town index: when its holiday began (it ends on any build after this), or null. */
  holidayFrom: (number | null)[];
  /** Goals board reward: the dayIndex of the Festival Weekend (null: none due). */
  festivalWeekend: number | null;
  /** The county month Kingsport last grew to (§8.1). */
  kingsportMonth: number;
  /** Gazette newsworthiness (§9.9): each town's usual weekly |change|, and last week's leading town (−1). */
  usual: number[];
  leader: number;
}

export interface AlertRecord {
  at: number;
  town: number | null;
  kind: 'month-reverted' | 'tick-reverted' | 'regional-day' | 'invariant' | 'other';
  message: string;
}

// ---- The Snapshot (published at the Regional Day; read-only during the day) -------

export interface Snapshot {
  /** The county seed: World(m) is a pure function of it (§5.16), and a phone must compute World to predict. */
  worldSeed: number;
  dayIndex: number;
  /** The instant it was published (0 before the first Regional Day). */
  at: number;
  /** County month at publication. */
  month: number;
  towns: SnapshotTown[];
  kingsport: { pop: number; stars: number[] };
  /** ΣN over active player towns (A15: not Kingsport). */
  sumN: number;
  medianPop: number;
  prices: { goods: number; food: number };
  /** County university seats (the Students pool). */
  universitySeats: number;
  season: { n: number; theme: string; startMonth: number; boomBust: boolean };
  /** The World event active today, announced yesterday. */
  event: WorldEventState | null;
  /** Fixed flows for today, by town index (a copy of county.flows at publication). */
  flows: TownDayFlows[];
  /**
   * WP2c addition: today's goods and food allocations (a copy of
   * county.allocations at publication, same indices as RealisedDay.shipped and
   * .received). A town's month step can read only the snapshot, so WP3 copies
   * them here; absent means none.
   */
  allocations?: Allocation[];
  /**
   * WP3 addition: the contracts running today (a copy of the started ones in
   * county.contracts, same indices as RealisedDay.delivered and .shortfall),
   * so a town's month step can deliver or draw power, water and freight
   * (§8.7). Absent means none.
   */
  contracts?: Contract[];
}

/** One town's public numbers in the snapshot (§8.3 step 9). */
export interface SnapshotTown {
  seat: SeatId;
  /** On the grid, not archived, not in its fortnight: takes part in settlement. */
  active: boolean;
  tier: Tier;
  pop: number;
  /** Persons by COHORT (Families count parents and children). */
  cohorts: number[];
  /** Perceived stars, STAR layout. */
  perceived: number[];
  /** Needs share by COHORT (0–1). */
  needs: number[];
  vacancies: number[];
  unemployed: number[];
  jobs: number[];
  attrQ: number;
  rep: number;
  aw: number;
  shopAppeal: number;
  goodsSurplus: number;
  foodSurplus: number;
  /** Minutes to each town index by link (−1: no open link). */
  linkTimes: number[];
  homesTax: number[];
  salesTax: number;
  hotelTax: number;
  holiday: boolean;
  grace: boolean;
  /** base64 32×32 u8 height map for the County view. */
  skyline: string;
}

export interface WorldEventState {
  id: string;
  /** County months, inclusive start, exclusive end. */
  fromMonth: number;
  toMonth: number;
}

/** World(m): a pure function of (county seed, county month) (§5.16). */
export interface WorldAt {
  month: number;
  G: number;
  goods: number;
  office: number;
  tourism: number;
  people: number;
  /** Annual base rate. */
  rBase: number;
  /** Progress through the season, 0 → 1. */
  seasonProgress: number;
  event: WorldEventState | null;
}

// ---- The Town ------------------------------------------------------------------------

/** A placed building record (compact array, §10.2 and A26): see B_* in tiles.ts. */
export type BuildingRecord = number[];

export interface Loan {
  principal: number;
  /** Annual rate, a fraction. */
  rate: number;
  monthsLeft: number;
  payment: number;
}

export interface Bond extends Loan {
  id: string;
  issuedMonth: number;
}

export interface HelperState {
  sinceDay: number;
  sinceTick: number;
  /** £ of Kingsport advance still owed. */
  advance: number;
  /** Escalation steps applied (A16): 0, 3, 6 days. */
  step: number;
}

export interface ActivePolicy {
  card: string;
  sinceTick: number;
  /** WP2d addition: the dayIndex it was enacted (a same-day repeal refunds the Initiative, §6.7). */
  sinceDay?: number;
  /** Painted area cards: rects [x, y, w, h, …]. */
  area: number[] | null;
}

export interface StandingOrder {
  kind: string;
  on: boolean;
  /** Adult-editable thresholds. */
  args: number[];
}

/**
 * One undoable plan (§9.3). `tiles` packs [tile, beforeUse, beforeLvl,
 * beforeAge, afterUse, afterLvl] per changed tile; building records are
 * stored whole. An undo checks the town still shows `after` everywhere.
 */
export interface UndoEntry {
  planId: string;
  day: number;
  atTick: number;
  cost: number;
  tiles: number[];
  added: BuildingRecord[];
  removed: BuildingRecord[];
  construction: number[];
  /** [tile, kind] terrain edits this plan added (cleared forest), removed again on undo. */
  terrainEdits: number[];
  parcelsBefore: number;
  rightsBefore: number;
}

export interface InboxItem {
  id: string;
  kind: string;
  day: number;
  from: number | null;
  data: Record<string, number | string>;
}

export interface Stamp {
  from: number;
  sticker: string;
  day: number;
}

export interface CitizenSeed {
  id: number;
  cohort: number;
  tier: number;
  /** A home tile, or −1. */
  home: number;
}

/**
 * The month and day books (WP1, A25): reserves = open + Σ lines at all
 * times, and population = popOpen + Σ pop. A package moves money only with
 * postMoney and changes the head-count only with postPeople (core.ts); the
 * invariant check enforces both after every town-month.
 */
export interface Books {
  open: number;
  lines: number[];
  popOpen: number;
  pop: number[];
  /** Since the last Regional Day (WP3 rolls these; WP2d reads them for the daily Why). */
  dayLines: number[];
  dayPop: number[];
}

/**
 * A41: the cross-town flows a town realised today, accumulated by its month
 * steps (WP2b labour and WP2c market write; WP3 reads and resets it at the
 * Regional Day, §8.3 step 1). Arrays indexed by tier are length 3; those
 * indexed by county.allocations / county.contracts use that day's indices.
 */
export interface RealisedDay {
  day: number;
  commutersIn: number[];
  commutersOut: number[];
  shopperSpendIn: number;
  shopperSpendOut: number;
  dayTripSpend: number;
  touristSpend: number;
  visitorsHosted: number;
  dayTripsHosted: number;
  /** Units per allocation index: shipped (as seller) and received (as buyer). */
  shipped: number[];
  received: number[];
  /** Units per contract index: delivered and short. */
  delivered: number[];
  shortfall: number[];
  /** Shared places used (patients, students) per month summed. */
  sharedUsed: number[];
  /**
   * WP2b addition (§5.11): migration intents to other player towns accrued
   * today, at (destination town index · 10 + cohort k), persons as doubles
   * (A25: rounded only at settlement). Absent until the first month that has
   * a linked destination; WP3 reads it at step 3 and the reset drops it.
   */
  intents?: number[];
}

/**
 * WP2b addition: the few people facts that must survive from one month to
 * the next and have no field of their own. Absent on a town that has not yet
 * run a WP2b month (read it as all zeros).
 */
export interface PeopleMemo {
  /** Residents of re-tiered homes who found no other home, by tier: all become forced movers next month (§5.11). */
  displaced: number[];
  /** Workers within their first youngMonths of adulthood (new adults and graduates), by tier (§4.4). */
  young: number[];
  /** Consecutive months the ££ vacancy has been above the filtering threshold (§5.8). */
  vacHigh: number;
  /** The public people numbers WP3 copies into the snapshot row: needs by COHORT (0–1), and vacancies, unemployed and job slots by tier. */
  needs: number[];
  vacancies: number[];
  unemployed: number[];
  jobs: number[];
}

/**
 * WP2c addition: the few market facts that must survive from one month to
 * the next and have no field of their own (slots die at month end). Absent
 * on a town that has not yet run a WP2c month.
 */
export interface MarketMemo {
  /** Smoothed (τ firms.surplusTau) production − local use per [goods, food], units a month: the projected surplus WP3 publishes. */
  surplus: number[];
  /** Consecutive months each SECTOR's m̄ has been below firms.closeMargin (WP2e closes its worst tiles at 3, §5.12). */
  lowMonths: number[];
  /** Last month's tourist satisfaction (0–100) and visitors (stays + day trips). */
  sat: number;
  visitors: number;
  /** Stays a month the town could sell if it had the beds (WP2e's hotel-variant test, §5.2). */
  bedDemand: number;
  /** Attr·Q and the tourist pull X = (Attr·Q)^1.1·(Rep/50)·(0.3 + 0.7·Aw)·Gate (§5.10): WP3 publishes and shares them. */
  attrQ: number;
  pull: number;
  /** Shop appeal SA's town part, ShopJobs^0.7·(1 + 0.3·Fun/100); WP3 applies the sales-tax gap (§5.12). */
  shopAppeal: number;
}

/**
 * WP2d addition: the few civic facts that must survive from one month to the
 * next, or from the last month step to the Regional Day (slots die at month
 * end). Absent on a town that has not yet run a WP2d month.
 */
export interface CivicMemo {
  /** Last month's running revenue and spending (£ a month, both ≥ 0): the borrowing base, DSR and months of spending. */
  revenue: number;
  spending: number;
  /** Homes tax (bp) the Deputy's budget order has added since reserves were last healthy (§5.18: at most 2 points). */
  deputyRaised: number;
  /** The Deputy's away zoning (§5.18): the dayIndex it last zoned on, and tiles zoned that day. */
  zonedDay: number;
  zonedToday: number;
  /** The dayIndex the away order last looked at the Village checklist's civic items (decision 6: one look, at most one item, a Regional Day); absent before the first. */
  civicDay?: number;
  /** The dayIndex the away order last looked for a short lane to open new roadside land (decision 8: at most one a Regional Day); absent before the first. */
  roadDay?: number;
  /** Lane looks on roadDay. */
  roadsToday?: number;
  /** The dayIndex the growth-help order last looked at the next tier's jobs and services (G3: one look a Regional Day); absent before the first. */
  helpDay?: number;
  /** Work lots the growth-help order zoned on helpDay (its daily allowance, shared by the day's months). */
  helpTiles?: number;
  /** Policy cards Helper Mode paused (§5.13 step 4), restored when it ends. */
  paused: ActivePolicy[];
  /** The next tier's checklist at the last month end (§7): its tier, met-item bits, item count. */
  check: { tier: number; met: number; items: number };
  /** Mood (0–100) at the last month end (§5.15). */
  mood: number;
  /** Town Talk at the last month end: the top items as [key, percent], percents summing to 100 (§5.15). */
  talk: [key: string, pct: number][];
  /** Wants bubbles and advisor card ids at the last month end (§5.15, §9.7). */
  wants: { key: string; severity: number }[];
  advisors: string[];
  /** The highest population seen at a Regional Day, and the struggling badge (§7: no demotion). */
  peak: number;
  struggling: boolean;
}

export interface TownState {
  seat: SeatId;
  ownerId: string;
  name: string;
  avatar: string;
  flag: number;
  site: number;
  /** WP1 addition: copied from the site at founding so a town is self-contained (page, forecast). */
  siteKind: SiteKind;
  terrainSeed: number;
  /** WP1 addition: this town's RNG seed, h32(county seed, 'seed', site, index). */
  seed: number;
  foundedAt: number;
  /** WP1 addition: county grid tick at founding (the World month of sprint ticks). */
  foundGrid: number;
  /** WP1 addition: county grid tick of town tick 0 once on the grid; null during the fortnight. */
  gridBase: number | null;
  // -- clock (WP1) --
  tick: number;
  sprintLeft: number;
  sprintAt: number;
  /** WP1 addition: "Play it all" is running. */
  sprintAuto: boolean;
  archived: boolean;
  // -- tier (WP2d) --
  tier: Tier;
  tierHold: number;
  /** Bitmask of the 16 open parcels (WP1). */
  parcels: number;
  /** Unused parcel rights (WP1 spends them, WP2d grants them). */
  parcelRights: number;
  // -- planes (WP1 codec; WP2e owns development writes) --
  /** base64(RLE(use u16 planar, lvl u8, age u8)); terrain regenerates from terrainSeed. */
  planes: string;
  planesRev: number;
  /** [tile, terrainKind] pairs: cleared forest, landfill. */
  terrainEdits: number[];
  /** [tile, ticksLeft] pairs (sparse). A building's entry sits at its anchor tile. */
  construction: number[];
  /** [tile, bits] pairs (sparse): MARK_* bits in tiles.ts. */
  marks: number[];
  /** OWNER WP2a: base64 32×32 u8 land value (rate-capped, persisted). */
  lv: string;
  /** [kind, x, y, rot, builtTick, funding, damaged, staffFill‰] (B_* in tiles.ts). */
  buildings: BuildingRecord[];
  /**
   * OWNER WP2a (A26): pollution lag field and last month's BPR factors ×1000 per district.
   * WP2a addition: `routes`, the BPR factors ×1000 drivers last chose their routes by (sticky:
   * a district's value moves only when its congestion has changed by transport.routeBand);
   * absent means free flow (1000 everywhere).
   */
  lag: { poll: string; congestion: number[]; routes?: number[] };
  /** A19: moves stamped atTick, not yet applied (normally empty). */
  pending: CommandRecord[];
  /**
   * A28 (review amendment): "type:id" of this seat's last 32 logged moves, so
   * a late re-post is still recognised after other players' moves have pushed
   * it out of the county log.
   */
  moveIds: string[];
  // -- people (WP2b) --
  people: number[];
  /**
   * WP2e addition (A12): founders' carts that found no home in a tick join
   * the £ waiting list here (cohorts wL and fL, at most one month of carts in
   * all), so the Homes meter sees a founding town's queue. WP2b owns the rest.
   */
  applicants: number[];
  aspirants: number[];
  squeezed: number;
  /** WP2b addition: unemployed for more than 6 months, by tier (forced movers, §5.11). */
  longUnemployed: number[];
  /** WP2b addition: month-to-month people memory (people.ts); absent = all zeros. */
  peopleMemo?: PeopleMemo;
  /** Flow carries, thousandths, by flow key (WP1 helper; each package uses its own key prefix). */
  carry: Record<string, number>;
  /** OWNER WP2b (homes) and WP2c (business), METER order. */
  meters: number[];
  /** OWNER WP2c: m̄ then m̄′ by SECTOR. */
  margins: number[];
  /** OWNER WP2b: perceived stars, STAR layout. */
  perceived: number[];
  /** OWNER WP2d: happiness by COHORT. */
  happy: number[];
  approval: number;
  culture: number;
  edu: number;
  rep: number;
  aw: number;
  ps: number;
  /** OWNER WP2c: [goods, food] units in stock. */
  goodsStock: number[];
  /** WP2c addition: month-to-month market memory (trade.ts); absent until the first WP2c month. */
  marketMemo?: MarketMemo;
  // -- finance (WP2d) --
  money: {
    reserves: number;
    loan: Loan | null;
    bonds: Bond[];
    /** Index into RATINGS. */
    rating: number;
    /** WP2d addition: signed months the rating's move condition has held. */
    ratingHold: number;
    overdraftMonths: number;
    helper: HelperState | null;
    /** WP2d addition: the dayIndex of the last Helper Mode episode (rating memory). */
    lastHelperDay: number | null;
    /** Review amendment: the dayIndex of Kingsport's last write-off (no new borrowing for a while after one). */
    lastWriteOffDay: number | null;
    fundAdvance: number;
  };
  /** Basis points (A25). homes is per tier. */
  taxes: { town: number; homes: number[]; business: number; sales: number; hotel: number };
  /** Per FUNDING_KEYS. */
  funding: number[];
  policies: ActivePolicy[];
  orders: StandingOrder[];
  initiatives: number;
  /** WP2d addition: month-to-month civic memory (finance.ts, mood.ts, tiers.ts); absent until the first WP2d month. */
  civicMemo?: CivicMemo;
  away: { lastHelloAt: number; weekStartPop: number; weekLoss: number };
  holiday: { until: number | null; usedDays: number };
  grace: number | null;
  shield: number | null;
  improvement: number[];
  // -- records --
  /** base64 Int32 rings (records.ts). */
  history: string;
  /** base64 packed Why rings (why.ts). */
  why: string;
  /** base64 ring of tile events (records.ts). */
  tileLog: string;
  /** The mayor's plans today (§9.3): only the mayor's moves, never the Deputy's (decision 11). */
  undo: UndoEntry[];
  /**
   * Decision 11: the Deputy's builds today, on their own list (at most
   * DEPUTY_UNDO_MAX), so they never push the mayor's plans out of `undo`; a
   * mayor may still undo one the same day for a full refund. Absent until the
   * Deputy first builds (read as empty).
   */
  deputyUndo?: UndoEntry[];
  /**
   * Decision 11: tiles of the mayor's plans today that fell out of `undo`
   * (past build.undoMax), so the Deputy still leaves them alone; sorted.
   * Absent unless that happened today.
   */
  mayorTouched?: { day: number; tiles: number[] };
  inbox: InboxItem[];
  stamps: Stamp[];
  trophies: string[];
  residents: CitizenSeed[];
  lastSeenTick: number;
  // -- WP1 additions --
  books: Books;
  realised: RealisedDay;
  /**
   * WP2e: the development memo, "<tick part>|<month part>" in base64, its own
   * codec (develop.ts): the incident allowance, builders turned away, per-tile
   * upgrade and closure notes, and last month's fields for the ticks' rolls.
   */
  dev: string;
  alerts: AlertRecord[];
}

// ---- Commands (§10.6) -------------------------------------------------------------------

export type Rect = [x: number, y: number, w: number, h: number];

export type Op =
  /** path: flattened points [x0, y0, x1, y1, …], each segment straight (an L is two). */
  | { op: 'road'; kind: DrawnRoad; path: number[] }
  | { op: 'zone'; zone: ZoneKind; rect: Rect }
  | { op: 'dezone'; rect: Rect }
  | { op: 'place'; id: string; x: number; y: number; rot: 0 | 1 }
  | { op: 'bulldoze'; rect: Rect }
  | { op: 'upgrade'; kind: DrawnRoad; path: number[] }
  | { op: 'parcel'; p: number };

export interface FoundBody {
  site: number;
  name?: string;
  nameParts?: [string, string];
  avatar: string;
  flag: number;
  /** Typed names need an adult or parent approval; the adapter decides and says so. */
  nameAllowed?: boolean;
  ownerId?: string;
}

export type TaxPatch = Partial<{ town: number; homes: number | number[]; business: number; sales: number; hotel: number }>;
export type FundingPatch = Partial<Record<FundingKey | keyof typeof FUNDING_GROUPS, Funding>>;

export type Command =
  | { type: 'hello'; moveId?: string }
  | ({ type: 'found'; moveId?: string } & FoundBody)
  | { type: 'sprint'; moveId?: string; auto?: boolean }
  | { type: 'build'; planId: string; plan: Op[] }
  | { type: 'undo'; moveId?: string; planId: string }
  | { type: 'budget'; moveId: string; taxes?: TaxPatch; funding?: FundingPatch }
  | { type: 'policy'; moveId: string; card: string; on: boolean; area?: number[] }
  | { type: 'orders'; moveId: string; orders: StandingOrder[] }
  | { type: 'loan'; moveId: string; take?: number; repay?: number }
  | { type: 'bond'; moveId: string; issue?: { size: 3 | 6 | 12; years: 10 | 20 }; repay?: { id: string } }
  | { type: 'deal'; moveId: string; offerId: string; accept: boolean }
  | { type: 'link'; moveId: string; propose?: { to: number; kind: Link['kind']; share: number }; answer?: { id: string; yes: boolean }; close?: { id: string } }
  | { type: 'contract'; moveId: string; offer?: Record<string, unknown>; answer?: { id: string; yes: boolean }; end?: { id: string } }
  | { type: 'share'; moveId: string; offer?: { service: 'health' | 'university'; places: number; price: number; /** WP3 addition: the linked town offered the places. */ to?: number }; answer?: { id: string; yes: boolean }; /** WP3 addition. */ end?: { id: string } }
  | { type: 'pact'; moveId: string; propose?: { to: number; kind: 'trail' | 'twin' }; answer?: { id: string; yes: boolean }; end?: { id: string } }
  | { type: 'pledge'; moveId: string; stage: number; input: string; amount: number }
  | { type: 'vote'; moveId: string; question: string; choice: number }
  | { type: 'bid'; moveId: string; festival: string }
  | { type: 'advert'; moveId: string; target: number; cohort: number }
  | { type: 'gift'; moveId: string; to: number; item: string }
  | { type: 'aid'; moveId: string; to: number; kind: string; amount: number }
  | { type: 'prank'; moveId: string; to: number; kind: string }
  | { type: 'prankReply'; moveId: string; id: string; choice: string }
  | { type: 'visit'; moveId?: string; seat: SeatId | null }
  | { type: 'stamp'; moveId: string; seat: SeatId; sticker: string }
  | { type: 'attend'; moveId: string; ribbonId: string }
  | { type: 'holiday'; moveId: string; days?: number; end?: boolean }
  | { type: 'pause'; moveId: string; on: boolean }
  | { type: 'settings'; moveId: string; county?: Partial<CountySettings>; seat?: Partial<SeatSettings> & { seat?: SeatId } }
  | { type: 'seen'; moveId?: string; tick: number };

export type MoveType = Command['type'];

export interface CommandResult {
  ok: true;
  /** The town tick before which it applied (A19), or −1 for a county move. */
  atTick: number;
  /** £ spent (positive) or refunded (negative). */
  cost: number;
  /** True when this result was replayed from the log for a repeated id (A28). */
  replayed?: boolean;
  data?: Record<string, unknown>;
}

export interface CommandRecord {
  /** planId or moveId; '' for moves without one (hello, seen, visit). */
  id: string;
  seat: SeatId;
  type: MoveType;
  at: number;
  atTick: number;
  cmd: Command;
  result: CommandResult;
}

/** Who is acting, as the adapter knows it (profile and parent flags gate some moves). */
export interface Actor {
  seat: SeatId;
  isParent?: boolean;
  profile?: 'kid' | 'adult';
}

// ---- Reports ------------------------------------------------------------------------------

export interface CatchUpResult {
  used: number;
  done: boolean;
  /** A27: true only for the finishing chunk, a chunk that ran a Regional Day, or one that advanced a streamed town. */
  changed: boolean;
}

export interface RegionalDayReport {
  dayIndex: number;
  at: number;
  /** False if the call was a no-op (wrong dayIndex: idempotency, A28). */
  ran: boolean;
  sprintsRun: number;
  countyWeek: boolean;
  steps: string[];
}

export interface PublicCard {
  seat: SeatId;
  name: string;
  avatar: string;
  flag: number;
  tier: Tier;
  pop: number;
  /** Persons by FACES. */
  faces: number[];
  /** Perceived town stars (the first 11 of the STAR layout). */
  stars: number[];
  taxes: { homes: number[]; business: number; sales: number; hotel: number };
  holiday: boolean;
  archived: boolean;
  inFortnight: boolean;
  skyline: string;
}

export interface Forecast {
  months: number;
  seeds: number;
  /** [low, median, high] across seeds, with and without the plan. */
  pop: { with: [number, number, number]; without: [number, number, number] };
  reserves: { with: [number, number, number]; without: [number, number, number] };
  /** £ the plan costs now. */
  cost: number;
  /** A refusal sentence if the plan is illegal (no run happened). */
  refused: string | null;
}

// ---- The month-step blackboard (A41) ------------------------------------------------------
//
// DerivedCache is created empty at the start of every month step and thrown
// away at its end; it is never stored and never read across a tick boundary
// (derived state must be recomputable from stored state, §10.2). Each slot has
// exactly ONE writing package (and step); later steps read it. The step table
// (steps.ts) declares what each step writes, and the driver refuses a step
// that sets a slot it did not declare or replaces one another step set.
// Until a package lands, its stub writes the slot's neutral value
// (derived.ts), so every downstream package can already run.
//
// Per-cell fields are 32×32 cells (CELLS = 1024) of 2×2 tiles; per-tile arrays
// are 4,096 long; districts are 64 of 8×8 tiles.

export interface UtilitiesSlot {
  /** Per tile: on a power grid and not cut by a brownout. */
  powered: Uint8Array;
  watered: Uint8Array;
  powerSupply: number;
  powerDemand: number;
  waterSupply: number;
  waterDemand: number;
  /** Bought from or sold to Kingsport this month (points / units). */
  powerImported: number;
  waterImported: number;
  powerExported: number;
  waterExported: number;
  /** £ this month (posted by WP2d in M13 from these numbers). */
  importCost: number;
  exportIncome: number;
  /** Tiles cut by brownouts this month. */
  cutTiles: number;
  /** Share of zoned built tiles with power / water (tier checklists). */
  poweredShare: number;
  wateredShare: number;
}

export interface FieldsSlot {
  pollution: Float64Array;
  noise: Float64Array;
  crime: Float64Array;
  /** LV* per cell before the rate cap (the lens lists its terms). */
  lvTarget: Float64Array;
  jobsAccess: Float64Array;
  custAccess: Float64Array;
  freight: Float64Array;
  visitorAccess: Float64Array;
  /** Town scalars. */
  pollutionPop: number;
  safety: number;
  gini: number;
  crimePressure: number;
  scenic: Float64Array;
}

export interface CoverageSlot {
  /** Per COVERAGES kind, 1,024 cells, 0–100. */
  cov: Float64Array[];
  /** Population-weighted town coverage per COVERAGES kind. */
  town: number[];
  /** Seats and capacities. */
  seats: { primary: number; secondary: number; university: number };
  pupils: { primary: number; secondary: number; university: number };
  healthCap: number;
  /** EduQ per level [primary, secondary, university], 0–1. */
  eduQ: number[];
  /** Share of homes inside a library's radius. */
  libraryShare: number;
  /** Health star inputs (A14). */
  healthCovered: number;
  healthQuality: number;
  /** A town-wide venue (Cinema, Stadium) exists. */
  funVenue: boolean;
  /** Civic staff needed by tier (A2 entry-level rules applied). */
  staffDemand: number[];
  /** Per building index: effect multiplier before staffing. */
  effect: Float64Array;
  /** WP2a addition: per building index, staff needed (persons; 0 while building). WP2b fills buildings[B_STAFF] against it. */
  staffNeeded?: number[];
}

export interface TravelSlot {
  /** District port tile per district, or −1. */
  port: Int16Array;
  /** Minutes district a → b at a·64 + b (Infinity: unreachable). */
  minutes: Float64Array;
  /** Road load per tile (trips per peak). */
  load: Float64Array;
  /** BPR factor per district (written to lag.congestion ×1000 by WP2a). */
  bpr: number[];
  avgCommute: number[];
  congestion: number;
  /** Minutes from each district to the Kingsport, west and east signposts. */
  toSignpost: Float64Array[];
  /** Bus and rail mode shares of commutes. */
  busShare: number;
  railShare: number;
  /** WP2a addition: workers per tier with no job district within maxCommute, or no road at home (§5.9 labour step 2). */
  unreachable?: number[];
}

export interface LabourSlot {
  workforce: number[];
  jobSlots: number[];
  employed: number[];
  unemployed: number[];
  /** Working one tier down (×0.8 wage). */
  underemployed: number[];
  trainees: number[];
  vacancies: number[];
  /** Built jobs and filled jobs per SECTOR. */
  sectorJobs: number[];
  sectorFilled: number[];
  fillRate: number[];
  civicStaffNeeded: number[];
  civicStaffFilled: number[];
  /** Overall civic staffFill (per building fill is written into buildings[B_STAFF]). */
  staffFill: number;
  wage: number[];
  prod: number;
  effJobs: number;
  /** £ per month by tier, and per person. */
  income: number[];
  incomePerPerson: number[];
  /** Outside money paid in (A1 support, pensions): not town budget lines. */
  support: number;
  pensions: number;
  commutersIn: number[];
  commutersOut: number[];
  /**
   * WP2b addition, per SECTOR: output-equivalent staff (trainees count
   * traineeEffect, A4) and the £ wage bill of the people working there
   * (trainees at their own tier's wage, in-commuters at this town's). Absent
   * from the neutral stub.
   */
  sectorEffective?: number[];
  sectorWages?: number[];
}

export interface HousingSlot {
  cap: number[];
  pipeline: number[];
  occ: number[];
  vacant: number[];
  rent: number[];
  rentShare: number[];
  afford: number[];
  squeezed: number;
  /** Homes meter targets and A9 reachability per tier. */
  target: number[];
  reachable: boolean[];
}

export interface StarsSlot {
  /** Actual stars, STAR layout. */
  actual: number[];
  /** U_happy per COHORT (A13). */
  uHappy: number[];
}

export interface NeedsSlot {
  /** Needs_h share per tier, and per COHORT for the snapshot. */
  tier: number[];
  cohort: number[];
  /** Unmet item count per tier (A10). */
  unmet: number[];
  /** Per tier, the ladder items' met shares in ladder order (the Wants bar). */
  items: number[][];
}

export interface MigrationSlot {
  movers: number[];
  leavers: number[];
  arrivals: number[];
  /** Intents to other player towns this month: [destination town index · 10 + k], persons (doubles). */
  intents: number[];
  /** Utility of the own town per COHORT. */
  utility: number[];
  /**
   * WP2b addition: home-grown movers (new adults, young adults, graduates)
   * who chose to go this month, per COHORT, as doubles before rounding:
   * [0] to the Outside World, [1] to player towns (intents). The brain-drain
   * measure (§4.4) and its Gazette story.
   */
  homeGrownOut?: [outside: number[], players: number[]];
}

export interface SpendSlot {
  retail: number;
  leisure: number;
  /** £ leaving with residents shopping over the border, and coming in. */
  shoppersOut: number;
  shoppersIn: number;
  visitorShops: number;
  visitorLeisure: number;
  inCommuterRetail: number;
  /** Retail + leisure turnover (the sales-tax base). */
  turnover: number;
}

export interface FirmsSlot {
  rev: number[];
  cost: number[];
  margin: number[];
  target: number[];
  jobs: number[];
  pipeJobs: number[];
  unfilled: number[];
  labourGate: number[];
  /** Σ_s Rev_s (the business-tax base). */
  turnover: number;
}

export interface GoodsSlot {
  /** [goods, food] units this month. */
  production: number[];
  localUse: number[];
  allocatedOut: number[];
  allocatedIn: number[];
  exported: number[];
  imported: number[];
  /** £ per unit received for exports. */
  exportPrice: number[];
  importPrice: number[];
}

export interface TourismSlot {
  stays: number;
  dayTrips: number;
  beds: number;
  attr: number;
  quality: number;
  satisfaction: number;
  hotelNights: number;
  spend: number;
  visitorRatio: number;
}

export interface LedgerSlot {
  /** This month's postings per LEDGER_LINES (a copy of books.lines at M13's end). */
  lines: number[];
  revenue: number;
  spending: number;
  net: number;
  /** Reserves in months of spending. */
  monthsOfSpending: number;
}

export interface MoodSlot {
  mood: number;
  /** Persons by FACES. */
  faces: number[];
  townTalk: [key: string, pct: number][];
  wants: { key: string; severity: number }[];
  advisors: string[];
}

/** WP2e's supply step (M1b): capacity from tiles, before utilities need demand. */
export interface DevelopmentSlot {
  /** Completed, undamaged Homes capacity and pipeline per tier (persons). */
  cap: number[];
  pipeline: number[];
  /** Built and pipeline jobs per SECTOR and tier: [s·3 + h]. */
  jobs: number[];
  pipeJobs: number[];
  beds: number;
  /** Zoned tiles per ZONE, and built tiles per ZONE. */
  zoned: number[];
  built: number[];
  /** A9: could any zoned tile take Homes tier h / zone k? */
  reachableHomes: boolean[];
  reachableZone: boolean[];
}

export interface DerivedCache {
  /** WP2e (M1b) */ development: DevelopmentSlot | null;
  /** WP2a (M2) */ utilities: UtilitiesSlot | null;
  /** WP2a (M3) */ fields: FieldsSlot | null;
  /** WP2a (M3) */ coverage: CoverageSlot | null;
  /** WP2a (M4) */ travel: TravelSlot | null;
  /** WP2b (M5) */ labour: LabourSlot | null;
  /** WP2b (M7a, completed in M12) */ housing: HousingSlot | null;
  /** WP2b (M10) */ stars: StarsSlot | null;
  /** WP2b (M10) */ needs: NeedsSlot | null;
  /** WP2b (M11) */ migration: MigrationSlot | null;
  /** WP2c (M7b) */ spend: SpendSlot | null;
  /** WP2c (M8) */ firms: FirmsSlot | null;
  /** WP2c (M7b) */ goods: GoodsSlot | null;
  /** WP2c (M6) */ tourism: TourismSlot | null;
  /** WP2d (M7c, completed in M13) */ ledger: LedgerSlot | null;
  /** WP2d (M14) */ mood: MoodSlot | null;
}
export type SlotName = keyof DerivedCache;

/** Why terms (§5.19): the writer every month step gets as m.why. */
export interface WhyWriter {
  /**
   * Adds `amount` (in the quantity's own units) to term `key` (registered in
   * why.ts). A term registered for a family of quantities (e.g. 'mig.in.schools'
   * for every arrive.<cohort>) names the one it explains in `quantity`.
   */
  add(key: string, amount: number, quantity?: string): void;
  /** Sets a quantity's value for this month (e.g. the meter, the population change). */
  set(quantity: string, v: number): void;
}

// ---- Contexts and steps --------------------------------------------------------------------

export interface TickContext {
  params: Params;
  snapshot: Snapshot;
  world: WorldAt;
  /** This town's seed. */
  seed: number;
  townIndex: number;
  /** The town tick being run (equal to t.tick while it runs). */
  tick: number;
  /** The grid instant at the end of this tick (sprint ticks: the founding instant). */
  at: number;
  /** Real calendar month 0–11 in Europe/London at `at` (tourism seasonality). */
  calendarMonth: number;
  rivalry: 'friendly' | 'spirited';
  mishaps: 'mild' | 'off';
  /** A Founding Fortnight sprint tick. */
  sprint: boolean;
  dayIndex: number;
  /** u32 = h32(seed, stream, a, b, tick): stateless; never depends on draw order. */
  rng(stream: StreamId, a: number, b: number): number;
}

export interface MonthContext extends TickContext {
  /** County month (the World index). */
  month: number;
  derived: DerivedCache;
  why: WhyWriter;
}

export type TickStep = (t: TownState, ctx: TickContext) => void;
export type MonthStep = (t: TownState, m: MonthContext) => void;

export interface MonthStepDef {
  id: string;
  owner: WorkPackage;
  /** Slots this step may set (exactly once each per month). */
  writes: SlotName[];
  run: MonthStep;
}

export interface TickStepDef {
  id: string;
  owner: WorkPackage;
  run: TickStep;
}

export interface RegionalContext {
  params: Params;
  dayIndex: number;
  at: number;
  /** County month at the instant. */
  month: number;
  /** Sunday's Regional Day (the County Week). */
  countyWeek: boolean;
  report: RegionalDayReport;
}
export type RegionalStep = (c: CountyState, r: RegionalContext) => void;
export interface RegionalStepDef {
  id: string;
  owner: WorkPackage;
  run: RegionalStep;
}

/** The engine's step table (steps.ts). Tests and the Lab may pass their own. */
export interface StepTable {
  tick: TickStepDef[];
  month: MonthStepDef[];
  regional: RegionalStepDef[];
}
