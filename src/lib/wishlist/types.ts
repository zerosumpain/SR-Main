// The wish list's shapes. PURE — no imports from the server, so the page, the
// sweep and the tests all read the same definitions.
//
// Money is integer PENCE everywhere. The health pipeline has been bitten twice
// by a value stored at one scale and read at another; a price that is always
// an integer number of pence cannot be.

/** `track`: one known product, watched for price. `hunt`: criteria, watched for listings that meet them. */
export type WishKind = 'track' | 'hunt';
export type WishStatus = 'watching' | 'paused' | 'bought' | 'dropped';

/**
 * The closed vocabulary a constraint may test. Every field here has a
 * deterministic extractor in `specs.ts`; there is no "ask the model whether it
 * matches", because a match the code cannot show its working for is a match
 * nobody should be alerted about.
 */
export type SpecField = 'gpu' | 'ram_gb' | 'ram_type' | 'storage_gb' | 'text';

export type Constraint =
  | { field: 'gpu'; op: 'rank_gte'; value: string }
  | { field: 'ram_gb' | 'storage_gb'; op: 'gte'; value: number }
  | { field: 'ram_type'; op: 'in'; value: string[] }
  | { field: 'text'; op: 'contains_any' | 'excludes_any'; value: string[] };

/** Where a hunt looks. Each is checked to resolve before it is saved. */
export type FeedRef =
  | { source: 'hukd-tag'; value: string }
  | { source: 'pricerunner-cl'; value: string }
  | { source: 'tavily'; value: string };

export interface WishCriteria {
  maxPricePence: number | null;
  /** Alert on a listing up to this far over the ceiling, as a near miss. Default 10%. */
  nearMissPct: number;
  constraints: Constraint[];
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
  source: 'hukd' | 'pricerunner' | 'retailer';
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
}
