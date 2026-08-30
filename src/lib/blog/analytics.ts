/**
 * Reader analytics — the PURE half.
 *
 * Split from the database readers deliberately, and the split is load-bearing
 * rather than tidiness. This module used to import `$lib/db`, which imports
 * `$env/dynamic/private`; SvelteKit's illegal-import guard walks the client
 * module graph and throws the moment a browser-bound component pulls a RUNTIME
 * value out of such a file. So the admin stats card could not call
 * `formatDwell` and had to carry its own copy of it — and this codebase has
 * already paid for duplicated helpers drifting apart (the sensitive-data
 * detector existed in three copies).
 *
 * `$lib/voice/score.ts` / `score.server.ts` is the same shape for the same
 * reason: the pure scorer runs in the browser as the author types, and the
 * server file adds the part that touches the disk.
 *
 * Queries live in ./analytics.server.
 */

/**
 * Reader analytics over the first-party engagement beacons in
 * `blog_post_views`. One row per (post, session): a *read*, not a person.
 *
 * The aggregation is a pure function over an array of rows and the DB readers
 * are a thin shell around it. That split is deliberate — the batch reader for
 * the admin list and the single-post reader must produce identical numbers, and
 * the only way to guarantee that is for both to call the same code. A second
 * aggregation expressed in SQL would drift from this one the first time a
 * definition changed, and nothing would fail loudly when it did.
 */

export type ViewRow = {
  dwellMs: number;
  maxScrollPct: number;
  completed: boolean;
  referrerHost: string | null;
  deviceClass: string | null;
  createdAt: Date;
};

export type DeviceStats = { deviceClass: string; reads: number; medianDwellMs: number };
export type ReferrerStats = { host: string; reads: number };
export type DailyStats = { day: string; reads: number; medianDwellMs: number };

export type ReadStats = {
  reads: number;
  medianDwellMs: number;
  meanDwellMs: number;
  completionRate: number;
  medianScrollPct: number;
  bounceRate: number;
  byDevice: DeviceStats[];
  topReferrers: ReferrerStats[];
  daily: DailyStats[];
};

// A bounce is brief AND shallow. Either test alone is a false positive: ten
// seconds on a 200-word post is a complete read, and someone who lands on a
// deep-linked heading has scrolled nothing but may still have stayed. Exported
// because the UI copy that explains the metric must not hard-code the numbers
// separately and then drift from them.
export const BOUNCE_DWELL_MS = 10_000;
export const BOUNCE_SCROLL_PCT = 25;

// A null device class is a beacon that fired before the viewport was measured,
// not a device called 'null'. It is bucketed rather than dropped: 'unknown'
// climbing is how a broken beacon announces itself, and discarding those rows
// would hide the fault while quietly shrinking every device median.
export const UNKNOWN_DEVICE = 'unknown';

const DEFAULT_REFERRER_LIMIT = 10;
const DAY_MS = 86_400_000;

// Drops non-finite values instead of propagating them. `dwellMs` is typed
// `number`, and NaN is a number — one corrupt row would otherwise turn every
// headline into NaN, which reaches the page as the string 'NaN%' rather than as
// anything that looks like an error. `reads` still counts the row; only the
// numeric summaries ignore it.
function finite(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v));
}

/**
 * MEDIAN, and it is the headline number rather than the mean on purpose.
 *
 * Dwell is long-tailed: a single tab left open through a lunch break outweighs
 * twenty honest two-minute reads and drags the mean somewhere no reader has
 * ever been. Visibility-gated dwell blunts that but does not remove it — a tab
 * can be genuinely visible and unattended. The mean is still reported beside
 * the median because the gap between the two IS the signal: when mean >> median
 * there is a tail worth looking at.
 */
function median(values: number[]): number {
  // `filter` already copied, so sorting cannot reorder the caller's array.
  const xs = finite(values).sort((a, b) => a - b);
  if (xs.length === 0) return 0;
  const mid = xs.length >> 1;
  // Even counts average the two middle values. Taking the upper one alone
  // biases every small sample upward, and small samples are the normal case
  // for a post in its first week.
  const m = xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
  // Rounded to whole milliseconds: the beacon samples on visibility changes,
  // so sub-millisecond precision is invented, and an integer survives JSON and
  // the formatter unchanged.
  return Math.round(m);
}

function mean(values: number[]): number {
  const xs = finite(values);
  if (xs.length === 0) return 0;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

// 0/0 must be 0. An empty window is the normal state of a post on its first
// day, and a rate of NaN renders as 'NaN%' on the card rather than failing.
function rate(matched: number, total: number): number {
  return total === 0 ? 0 : matched / total;
}

/**
 * UTC day key, 'YYYY-MM-DD'.
 *
 * TIMEZONE MISMATCH, deliberate and load-bearing: the Umami accessor next door
 * (`src/lib/umami/client.ts`, `getDailyViews`) hard-codes
 * `timezone=Europe/London`, so its day boundaries sit an hour earlier than
 * these through British Summer Time. The two series are therefore NOT
 * interchangeable — overlaying them as one line moves up to an hour of traffic
 * across a boundary and shows a phantom dip on the day of a clock change.
 * Convert one, or label both, but never plot them together unannounced.
 *
 * Returns null for an unusable date rather than throwing: `toISOString()` on an
 * Invalid Date raises, and one bad row must not turn an admin page into a 500.
 * Such a row still counts in `reads`, so `daily` need not sum to it.
 */
function utcDay(value: Date): string | null {
  const t = value?.getTime?.();
  if (typeof t !== 'number' || Number.isNaN(t)) return null;
  return value.toISOString().slice(0, 10);
}

function deviceKey(value: string | null): string {
  // Whitespace-only is treated as absent for the same reason null is: it is a
  // beacon that sent nothing, spelled differently.
  const v = (value ?? '').trim();
  return v === '' ? UNKNOWN_DEVICE : v;
}

function push(map: Map<string, number[]>, key: string, value: number): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

// Ties break on the key ascending so repeated calls order equal rows the same
// way — a table that reshuffles two tied referrers on every reload reads as a
// bug. Compared by code point rather than `localeCompare`, whose ordering
// depends on the runtime's ICU data and so differs between homeserv and the VPS.
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function summariseViews(rows: ViewRow[], opts?: { referrerLimit?: number }): ReadStats {
  const reads = rows.length;

  let completedCount = 0;
  let bounceCount = 0;
  const dwells: number[] = [];
  const scrolls: number[] = [];
  const deviceDwells = new Map<string, number[]>();
  const referrerCounts = new Map<string, number>();
  const dayDwells = new Map<string, number[]>();

  for (const r of rows) {
    dwells.push(r.dwellMs);
    scrolls.push(r.maxScrollPct);
    if (r.completed) completedCount++;
    if (r.dwellMs < BOUNCE_DWELL_MS && r.maxScrollPct < BOUNCE_SCROLL_PCT) bounceCount++;

    push(deviceDwells, deviceKey(r.deviceClass), r.dwellMs);

    // A null or empty referrer is DIRECT traffic — typed, bookmarked, or from
    // an app that strips the header — and is excluded from this table rather
    // than bucketed as 'direct'. Direct would top the list on almost every
    // post and crowd out the handful of rows the table exists to show.
    // Hosts are not case-folded: the writer stores `new URL(ref).host`, which
    // is already lower-case, so folding here would mask a writer bug rather
    // than fix one.
    const host = (r.referrerHost ?? '').trim();
    if (host !== '') referrerCounts.set(host, (referrerCounts.get(host) ?? 0) + 1);

    const day = utcDay(r.createdAt);
    if (day !== null) push(dayDwells, day, r.dwellMs);
  }

  const rawLimit = opts?.referrerLimit ?? DEFAULT_REFERRER_LIMIT;
  // NaN would reach `slice(0, NaN)` and silently empty the table, so a
  // nonsense limit falls back to the default rather than to nothing.
  const limit = Number.isFinite(rawLimit)
    ? Math.max(0, Math.floor(rawLimit))
    : DEFAULT_REFERRER_LIMIT;

  const byDevice = [...deviceDwells.entries()]
    .map(([deviceClass, values]) => ({
      deviceClass,
      reads: values.length,
      medianDwellMs: median(values),
    }))
    .sort((a, b) => b.reads - a.reads || compareKeys(a.deviceClass, b.deviceClass));

  const topReferrers = [...referrerCounts.entries()]
    .map(([host, count]) => ({ host, reads: count }))
    .sort((a, b) => b.reads - a.reads || compareKeys(a.host, b.host))
    .slice(0, limit);

  const daily = [...dayDwells.entries()]
    .map(([day, values]) => ({ day, reads: values.length, medianDwellMs: median(values) }))
    // 'YYYY-MM-DD' sorts lexicographically in chronological order, which is
    // why the key is a string and not a Date.
    .sort((a, b) => compareKeys(a.day, b.day));

  return {
    reads,
    medianDwellMs: median(dwells),
    meanDwellMs: mean(dwells),
    completionRate: rate(completedCount, reads),
    medianScrollPct: median(scrolls),
    bounceRate: rate(bounceCount, reads),
    byDevice,
    topReferrers,
    daily,
  };
}

/**
 * '0s' · '45s' · '2m 10s' · '1h 3m'
 *
 * Zero remainders are NOT elided ('2m 0s', not '2m'): in a column of these the
 * string width would otherwise jump between rows on the one value that happens
 * to land on a boundary. Seconds are dropped past an hour because at that scale
 * they are noise, and a dwell that long is a tab left open rather than a read.
 */
export function formatDwell(ms: number): string {
  // Negative and non-finite are impossible from the integer column but trivial
  // to post from a hand-rolled beacon; a formatter is the wrong place to raise.
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m ${totalSeconds % 60}s`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

// ---------------------------------------------------------------------------
// DB readers. Thin: fetch rows, hand them to summariseViews, return.
// ---------------------------------------------------------------------------
