// The wish list's shapes. PURE — no imports from the server, so the page, the
// sweep and the tests all read the same definitions.
//
// Money is integer PENCE everywhere. The health pipeline has been bitten twice
// by a value stored at one scale and read at another; a price that is always
// an integer number of pence cannot be.

import type { UnitId } from './units';

/** `track`: one known product, watched for price. `hunt`: criteria, watched for listings that meet them. */
export type WishKind = 'track' | 'hunt';
export type WishStatus = 'watching' | 'paused' | 'bought' | 'dropped';

/**
 * The closed vocabulary a constraint may test. Every field here has a
 * deterministic extractor in `specs.ts`; there is no "ask the model whether it
 * matches", because a match the code cannot show its working for is a match
 * nobody should be alerted about.
 */
export type SpecField = 'gpu' | 'ram_gb' | 'ram_type' | 'storage_gb' | 'text' | 'attr';

export type Constraint =
  | { field: 'gpu'; op: 'rank_gte'; value: string }
  | { field: 'ram_gb' | 'storage_gb'; op: 'gte'; value: number }
  | { field: 'ram_type'; op: 'in'; value: string[] }
  | { field: 'text'; op: 'contains_any' | 'excludes_any'; value: string[] }
  /**
   * Any measurable thing, for any kind of product: a TV's "55in or more", a
   * holiday's "at least 7 nights" or "4 stars+", a LEGO set's pieces. `unit`
   * picks the fixed reader in `units.ts`; `label` is what the page calls it.
   * `essential`: a listing that does not state it is not one we can vouch for
   * (the GPU rule, generalised) — otherwise one unstated detail is a "Check".
   */
  | { field: 'attr'; label: string; unit: UnitId; op: 'gte' | 'lte'; value: number; essential?: boolean };

/**
 * One thing the value score weighs. `measure` is a unit from `units.ts`, or one
 * of the PC readers (`gpu`/`cpu` rankings, RAM, storage). Each listing scores
 * value/ref (or ref/value when lower is better), capped at 2×, times `weight`.
 */
export interface ValueFactor {
  label: string;
  measure: UnitId | 'gpu' | 'cpu' | 'ram_gb' | 'storage_gb';
  weight: number;
  /** What a typical good one has — scores 1.0. */
  ref: number;
  better: 'higher' | 'lower';
}

/** Where a hunt looks. Each is checked to resolve before it is saved. */
export type FeedRef =
  | { source: 'hukd-tag'; value: string }
  | { source: 'pricerunner-cl'; value: string }
  /** An Overclockers category path, e.g. `pc-systems/pcs-by-price/gaming-pcs-under-1000`. */
  | { source: 'ocuk-cat'; value: string }
  /** A Scan category path from `SCAN_CATEGORIES`. */
  | { source: 'scan-cat'; value: string }
  /** A subreddit from `REDDIT_SUBS`. */
  | { source: 'reddit'; value: string }
  /** HolidayPirates' deal feed (one feed; value is always "deals"). */
  | { source: 'holidaypirates'; value: string }
  | { source: 'tavily'; value: string };

export interface WishCriteria {
  maxPricePence: number | null;
  /** Alert on a listing up to this far over the ceiling, as a near miss. Default 10%. */
  nearMissPct: number;
  constraints: Constraint[];
  /** What "value for money" means for this item; empty = cheapest is best. */
  value?: ValueFactor[];
  /**
   * Holidays and tickets are priced per person. With `per: 'total'` and a
   * party size, a listing priced "pp" is compared at price × party.
   */
  price?: { per: 'total' | 'person'; party: number | null };
}

export interface WishItem {
  id: string;
  principalId: string;
  kind: WishKind;
  status: WishStatus;
  title: string;
  /** The words as typed — kept so a re-compile starts from what was asked, not from a lossy summary. */
  ask: string;
  criteria: WishCriteria;
  feeds: FeedRef[];
  /** Track only: the product page(s) to re-read. */
  urls: string[];
  /** Track only: tell me when it falls to or below this. */
  targetPricePence: number | null;
  /** Free text — who it is for. Phase 2 hides the item from that person. */
  forPerson: string | null;
  /** ISO date the item stops being useful (a gift's day). */
  deadline: string | null;
  createdAt: string;
  lastCheckedAt: string | null;
  /** Web search costs credits, so a hunt searches at most daily, whatever its cadence. */
  lastSearchedAt?: string | null;
  lastError: string | null;
}

export type Verdict = 'match' | 'possible' | 'near' | 'no';

export interface ConstraintResult {
  field: SpecField | 'price';
  ok: boolean | null; // null = the listing does not say
  reason: string;
  /** An unstated essential attribute rules the listing out. */
  essential?: boolean;
}

export interface Evaluation {
  verdict: Verdict;
  results: ConstraintResult[];
}

export interface PricePoint {
  at: string;
  pence: number;
  inStock: boolean | null;
}

/** One listing (a deal post, a product page, one seller's offer) as last seen. */
export interface WishOffer {
  itemId: string;
  /** Stable per listing — see `offerKey`. */
  key: string;
  source: 'hukd' | 'pricerunner' | 'retailer' | 'reddit' | 'holidaypirates';
  title: string;
  description: string;
  url: string;
  merchant: string | null;
  pricePence: number;
  inStock: boolean | null;
  verdict: Verdict;
  results: ConstraintResult[];
  firstSeenAt: string;
  lastSeenAt: string;
  /** Newest last, capped. */
  history: PricePoint[];
  /** The price band an alert was last sent at, so the same deal never alerts twice. */
  alertedPence: number | null;
  /** PriceRunner product pages: every seller, cheapest first. */
  sellers?: { merchant: string; pricePence: number; inStock: boolean | null }[];
  perPerson?: boolean;
}

/** What a source hands the sweep before it is judged. */
export interface Candidate {
  source: WishOffer['source'];
  title: string;
  description: string;
  url: string;
  merchant: string | null;
  pricePence: number | null;
  inStock: boolean | null;
  /** HUKD posts: when it was posted. Older posts are usually expired deals. */
  postedAt?: string | null;
  sellers?: WishOffer['sellers'];
  /** The source prices per person (HolidayPirates always does). Otherwise read from "pp" in the text. */
  perPerson?: boolean;
}
