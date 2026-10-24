// The county layer's tunables (WP3, spec §8) that params.v1.json does not
// carry yet. They follow the params rule (§11.5, A38): versioned by params
// version, frozen, never a module global the Lab cannot see. They live here
// rather than in params.v1.json only because that file is being tuned in
// parallel (M0); at the merge they move into a `county` group of the params
// file unchanged, and regionParams() then reads them from there.
//
// The link table itself is content (content.ts LINKS); everything that is a
// rate, a cap or a share is here. Values are the spec's; each line names its
// section.

import type { ParamsVersion } from './params';

export interface RegionParams {
  /** Minutes added at each end of a link (§8.2: 5), and a town's own district-to-signpost time until WP2a publishes it. */
  terminalMinutes: number;
  internalMinutes: number;
  /** A bus service makes riders' trips this much shorter (§8.2: "riders −20%"). */
  busTime: number;
  /** A link's daily trips cap counts a day trip as this share of a day (a month of day trips spread over its days). */
  dayTripLoad: number;
  /** Days of notice before a link closes (§8.2). */
  closeNoticeDays: number;
  /** Commuter decay e^(−t/this) and the unemployed's own weight in the denominator (§8.5). */
  commuteDecay: number;
  commuteStay: number;
  /** Shopper decay e^(−t/this) and the leak's 0.4 (§5.12). */
  shopDecay: number;
  shopLeak: number;
  /** Sales-tax gap: shop appeal × (1 − this per percentage point of gap), clamped (§5.12). */
  salesTaxGap: number;
  salesTaxGapBand: [number, number];
  /** Day trips DT[j→c] = N_j·rate·AQ_c/(AQ_c + AQ_j + offset)·e^(−t/decay) (§5.10). */
  dayTripRate: number;
  dayTripOffset: number;
  dayTripDecay: number;
  /** Twin Towns: day trips × this both ways (§8.7). */
  twinDayTrips: number;
  /** A coach of day-trippers gift: +this many day trips that month (§6.8). */
  coachTrips: number;
  /** Goods: shipping £ per unit-minute, and the county price's gain and daily step (§8.5). */
  shipping: number;
  priceGain: number;
  priceStep: number;
  /** Goods shortfall cap: a share of the allocation's value (A17). */
  goodsShortfallCap: number;
  /** Contract shortfall cap: weeks of the contract's value (A17), and Regional Days in a County Week. */
  contractShortfallWeeks: number;
  weekDays: number;
  /** Contract length bounds in County Weeks (§8.7). */
  contractWeeks: [number, number];
  /** Freight contracts pay the shipping partner £ per industry job-month (§8.7). */
  freightPerJob: number;
  /** Shared places: e^(−t/this), at most this share of the partner's need, fees per patient- and student-month (§8.5). */
  sharedDecay: number;
  sharedMaxShare: number;
  sharedFees: [number, number];
  /** The commuter rule's transfer per commuter-month, by option (§8.5), and the default option. */
  commuterRule: [number, number, number];
  commuterRuleDefault: number;
  /** Shared air (Spirited only): this share of the facing edge's pollution drifts downwind; the Clean Air Pact halves it (§8.5, §8.9). */
  sharedAir: number;
  /** Player migration: a destination takes at most this share of its vacancies a day; a MoveStory needs this many people (§8.4). */
  housingShare: number;
  storyMin: number;
  /** Community Spirit lasts this many Regional Days (§8.4). */
  shieldDays: number;
  /** Gifts per sender to each recipient per day; coins as a share of last month's revenue, capped (§6.8). */
  giftsPerDay: number;
  giftCoinShare: number;
  giftCoinMax: number;
  /** Pranks per sender to each recipient per County Week (§6.8). */
  pranksPerWeek: number;
  /** Aid: at most this share of reserves (§8.7). */
  aidShare: number;
  /** Adverts (§8.6): minimum cost, Regional Days running, awareness, tourist pull bonus, and per-pair weekly limit by rivalry. */
  advertMin: number;
  advertDays: number;
  advertAwareness: number;
  advertTourism: number;
  advertsPerWeek: { friendly: number; spirited: number };
  /** Guestbook stamps: Buzz per distinct visitor per day, capped (§9.10). */
  stampBuzz: number;
  stampBuzzCap: number;
  /** Festival host: tourist share × (1 + this); linked towns get this share of the extra as day trips (§8.6). */
  festivalHost: number;
  festivalLinked: number;
  /** Holiday: at most this many days a season (§2.4). */
  holidayDays: number;
  /** A season is this many County Weeks (A22). */
  seasonWeeks: number;
  /** County Fair: categories drawn each week (§8.9). */
  awardsPerWeek: number;
  /** Goals board: goals each week and the rewards' thresholds (§8.7 item 9). */
  goals: number;
  goalRewards: [number, number, number];
  /** Festival Weekend: tourist pool × this for a day (§8.7). */
  festivalWeekendTourism: number;
  /** Twin Towns need this many friendship weeks (§8.7). */
  twinWeeks: number;
  /** A40: the lobby warns from this many days without a hello; the row is deleted this many days after the heartbeats stop. */
  expiryWarnDays: number;
  expiryAbandonedDays: number;
  /** Gazette (§9.9): firsts weigh ×this; last week's leader's score × this. */
  gazetteFirst: number;
  gazetteLeader: number;
  /** A late joiner (§8.12): a county is "mature" after this many Regional Days; the top-up is this share of the median reserves, at most this. */
  lateJoinDays: number;
  lateJoinShare: number;
  lateJoinMax: number;
}

const V1: RegionParams = {
  terminalMinutes: 5,
  internalMinutes: 5,
  busTime: 0.8,
  dayTripLoad: 1 / 30,
  closeNoticeDays: 7,
  commuteDecay: 20,
  commuteStay: 0.5,
  shopDecay: 15,
  shopLeak: 0.4,
  salesTaxGap: 0.12,
  salesTaxGapBand: [0.5, 1.5],
  dayTripRate: 0.015,
  dayTripOffset: 40,
  dayTripDecay: 40,
  twinDayTrips: 1.15,
  coachTrips: 150,
  shipping: 2,
  priceGain: 0.1,
  priceStep: 0.05,
  goodsShortfallCap: 0.1,
  contractShortfallWeeks: 1,
  weekDays: 7,
  contractWeeks: [1, 4],
  freightPerJob: 20,
  sharedDecay: 30,
  sharedMaxShare: 0.3,
  sharedFees: [25, 150],
  commuterRule: [0, 15, 30],
  commuterRuleDefault: 1,
  sharedAir: 0.05,
  housingShare: 0.5,
  storyMin: 20,
  shieldDays: 7,
  giftsPerDay: 1,
  giftCoinShare: 0.01,
  giftCoinMax: 10000,
  pranksPerWeek: 1,
  aidShare: 0.1,
  advertMin: 20000,
  advertDays: 3,
  advertAwareness: 0.03,
  advertTourism: 0.05,
  advertsPerWeek: { friendly: 1, spirited: 2 },
  stampBuzz: 0.5,
  stampBuzzCap: 3,
  festivalHost: 0.4,
  festivalLinked: 0.25,
  holidayDays: 21,
  seasonWeeks: 6,
  awardsPerWeek: 6,
  goals: 8,
  goalRewards: [4, 6, 8],
  festivalWeekendTourism: 1.15,
  twinWeeks: 4,
  expiryWarnDays: 60,
  expiryAbandonedDays: 30,
  gazetteFirst: 3,
  gazetteLeader: 0.5,
  lateJoinDays: 7,
  lateJoinShare: 0.25,
  lateJoinMax: 200_000,
};

const FILES: Record<ParamsVersion, RegionParams> = { v1: deepFreeze(V1) };

/** The county layer's tunables for a params version. */
export function regionParams(version: ParamsVersion): RegionParams {
  const r = FILES[version];
  if (!r) throw new Error(`unknown params version ${String(version)}`);
  return r;
}

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const k of Object.keys(x as object)) deepFreeze((x as Record<string, unknown>)[k]);
    Object.freeze(x);
  }
  return x;
}
