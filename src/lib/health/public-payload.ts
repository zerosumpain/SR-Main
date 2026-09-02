// What an anonymous visitor to /health is allowed to receive.
//
// /health is the only public page on this site that sits next to owner-only
// data: the hub's children (/health/activities, /health/segments, /health/plan,
// /health/record) hold 1,100+ GPS traces, and a GPS trace starts at the front
// door. The page splits into two payloads rather than one payload and an
// `{#if owner}` — a template branch still ships the bytes to the browser.
//
// This module makes that split STRUCTURAL instead of careful. The public branch
// is built by picking from an explicit allow-list, so a field added to the
// shared object later is absent from the anonymous payload by default rather
// than present by accident; and `disclosureLeaks` is the second belt, walking
// whatever was built and naming anything that could place John somewhere.
//
// 2026-09-02: anonymous visitors now read the SAME nine-section dashboard the
// owner does, minus the two sections that carry ground. That moved a whole
// derived layer onto this list — every one of those keys is a rule over numbers
// already published, and none of them names a place. Two structs could not be
// allow-listed at all, because they carry a place inside an otherwise
// publishable shape: `TrailsDashboard.workouts` (Strava titles ARE place names)
// and the gettable board (segment names, and an id that deep-links the ground).
// Those are PROJECTED by the two functions at the foot of this file, and the
// projection is what the loader ships — the allow-list never sees them.

/**
 * The only keys an anonymous visitor receives.
 *
 * Every one of these is an aggregate body metric or already-published copy.
 * Adding a key here is a deliberate, reviewable act — which is the point.
 */
export const PUBLIC_FIELDS = [
  // ——— the body, as the landing has published it since launch ————————
  'series', // 30 days of daily numbers — no timestamps, no places
  'today',
  'rhrBaseline',
  'todayDeltas',
  'syncedAgoSeconds',
  'provenance',
  'readiness',
  'vo2max',
  'sleepRegularity',

  // ——— the derived instrument layer (sections B–E, H, I) ————————————
  //
  // Added 2026-09-02 with the shared dashboard. Every one of these is a pure
  // rule over the metrics above — no query of its own, no model, and nothing
  // that names a segment, an outing or a piece of ground. `tripwires` is the
  // one that had to be built differently rather than merely allowed: its
  // segment row quotes the nearest record BY NAME, so the loader passes it a
  // `nearest`-stripped summary and the row falls back to counts.
  'dashboardUpdatedAt',
  'acwr',
  'monotony',
  'polarised',
  'circadian',
  'autonomic',
  'recoveryDebt',
  'volume',
  'forecast',
  'moves',
  'tripwires',
  'experiments',
  'verdict',
] as const;

export type PublicField = (typeof PUBLIC_FIELDS)[number];

/** Keep only the allow-listed keys. Anything else never reaches the browser. */
export function pickPublic<T extends Record<string, unknown>>(
  source: T,
): Pick<T, Extract<PublicField, keyof T>> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_FIELDS) {
    if (key in source) out[key] = source[key as keyof T];
  }
  return out as Pick<T, Extract<PublicField, keyof T>>;
}

/**
 * Root keys the walker steps over, and the reason for each.
 *
 * `featuredActivities` used to be the only entry: hand-flagged rows whose
 * routes the landing's closing chapter drew, public since launch. That chapter
 * went with the old public document on 2026-09-02, so the last PLACE-BEARING
 * exemption is gone and a polyline under that key is now a leak like any other.
 *
 * The set is empty, and the mechanism is kept for the next carve-out that has
 * to be argued for in the open. `dashboardUpdatedAt` sat here briefly and moved
 * to `COMPUTATION_STAMP_KEYS` below, which is where it belonged: it is not a
 * carve-out for a place, it is a whole CLASS of value the timestamp pattern
 * cannot tell from a place.
 */
const DISCLOSURE_EXEMPT_ROOTS = new Set<string>();

/**
 * Keys whose value stamps when a FIGURE was computed or last read — never when
 * he was somewhere.
 *
 * Measured in production on 2026-09-02, the anonymous payload tripped
 * `LOCAL_TIMESTAMP` THIRTEEN times on a single request, and every one was a
 * false positive of this shape: `MetricResult.asOf` (when the analytic ran) on
 * each of the nine instruments, and `readiness.factors.hrvTrend.observedAt`
 * (the date of the newest HRV row). Three of them had been firing on every
 * anonymous request since long before the shared dashboard; the instrument
 * layer took it to thirteen.
 *
 * That matters more than the noise. A guard that cries wolf on every single
 * request is a guard nobody reads, and the ONE line that matters would arrive
 * in a log where thirteen identical ones already scroll past. So the pattern is
 * skipped for these keys and kept for every other one — including the bare `at`
 * or `when` an outing's clock would land under, which is what it was written
 * for. Loosening the pattern itself was the alternative and it is the wrong
 * one: it would have to stop matching `2026-08-20T06:41:12Z`, which is exactly
 * an activity start.
 */
const COMPUTATION_STAMP_KEYS =
  /^(asof|observedat|computedat|generatedat|assembledat|updatedat|lastupdated|dashboardupdatedat|syncedat|lastsync|refreshedat)$/;

/** Lower-case, alphanumerics only — so `as_of`, `asOf` and `AsOf` all match. */
function stampKey(path: string): string {
  const last = path.split('.').pop() ?? '';
  return last.replace(/\[\d+\]$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * Keys that carry a route. Matched as a SUBSTRING, not an exact name: this repo
 * writes `polyline`, `summary_polyline`, `coordinates`, `startLat`, `bounds`
 * and `latlng` in different places, and an exact-name list is a list of the
 * spellings someone happened to think of.
 */
const GEOMETRY_KEYS = /(polyline|coordinate|coords|bounds|latlng|\blat\b|\blng\b|\blon\b|longitude|latitude|geometry|waypoint)/i;

/** Keys that name a specific outing or a specific piece of ground. */
const IDENTITY_KEYS = /(segmentname|segmentid|activityid|startdatelocal|timezone|\btrack\b)/i;

/** A `YYYY-MM-DD hh:mm` local stamp — the clock John was out at. */
const LOCAL_TIMESTAMP = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

/** A what3words-style segment name: three lowercase words joined by dots. */
const SEGMENT_NAME = /^[a-z]+\.[a-z]+\.[a-z]+$/;

/** A run of encoded-polyline characters with no whitespace and no vowels. */
const ENCODED_POLYLINE = /^[\x3F-\x7E]{30,}$/;

/**
 * Walk a payload and name everything in it that could disclose a place, a
 * route, or the clock of a specific outing. An empty array means the payload is
 * safe to hand an anonymous browser.
 *
 * Returns dotted paths so a failure says WHERE, not just that something is
 * wrong.
 */
export function disclosureLeaks(value: unknown, path = ''): string[] {
  const found: string[] = [];

  const walk = (node: unknown, at: string, depth: number) => {
    if (node == null || depth > 12) return;

    if (typeof node === 'string') {
      // The key decides whether a timestamp is a disclosure. `asOf` is when the
      // analytic ran; `startedAt` is when he set off. Only the second is a
      // clock worth catching, and nothing but the key can tell them apart.
      if (LOCAL_TIMESTAMP.test(node) && !COMPUTATION_STAMP_KEYS.test(stampKey(at)))
        found.push(`${at}: local timestamp`);
      else if (SEGMENT_NAME.test(node)) found.push(`${at}: segment name`);
      // An encoded polyline under a key nobody thought to name. Google's
      // algorithm emits printable ASCII 63–126 in dense runs; ordinary prose
      // does not go 30 characters without a space or a vowel.
      else if (ENCODED_POLYLINE.test(node)) found.push(`${at}: encoded polyline`);
      return;
    }
    if (typeof node !== 'object') return;

    if (Array.isArray(node)) {
      // A pair of plausible WGS84 numbers is a coordinate wherever it appears.
      if (
        node.length >= 2 &&
        node.length <= 4 &&
        typeof node[0] === 'number' &&
        typeof node[1] === 'number' &&
        Math.abs(node[0] as number) <= 180 &&
        Math.abs(node[1] as number) <= 90 &&
        // At least one fractional part. A whole-number pair is far more likely
        // to be a count or an index than a position — [7, 30] is a week and a
        // month, not somewhere in Sudan — but a real fix on a whole degree is
        // vanishingly rare and would still trip the key check above.
        (!Number.isInteger(node[0]) || !Number.isInteger(node[1]))
      ) {
        found.push(`${at}: coordinate pair`);
        return;
      }
      node.forEach((item, i) => walk(item, `${at}[${i}]`, depth + 1));
      return;
    }

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = at ? `${at}.${key}` : key;
      if (!at && DISCLOSURE_EXEMPT_ROOTS.has(key)) continue;
      // `startLat` has no word boundary before "lat", so the key is split at
      // camel-case and underscore transitions before it is matched. Without
      // this the walker misses exactly the spellings a real payload uses.
      const normalised = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]/g, ' ')
        .toLowerCase();
      if (child != null && (GEOMETRY_KEYS.test(normalised) || IDENTITY_KEYS.test(normalised))) {
        found.push(`${childPath}: ${key}`);
        continue;
      }
      walk(child, childPath, depth + 1);
    }
  };

  walk(value, path, 0);
  return found;
}

// ---------------------------------------------------------------------------
// The two projections
//
// An allow-list answers "which KEYS go out". These answer the harder question:
// what to do with a struct that is publishable apart from the two fields inside
// it that place him. Picking cannot express that, and `disclosureLeaks` would
// not catch either case — `name` is in neither key pattern, and `SEGMENT_NAME`
// is anchored, so a segment name inside a sentence walks straight past it. So
// they are reshaped here, generically over the shape rather than against an
// imported type: this module sits in the domain layer and the structs it
// narrows are declared in the database and UI layers above it.
// ---------------------------------------------------------------------------

/**
 * `TrailsDashboard`, with the workouts reduced to the one field the dashboard
 * actually reads off them.
 *
 * Section A takes exactly one thing from `dashboard.workouts`: how many fall
 * inside the headline week (`StateOfPlay.svelte`, the week-volume tile). The
 * rows themselves carry `id`, `startDate` and `name` — and a Strava title is a
 * place name most of the time ("Morning run, Teesdale Way"), which is the whole
 * category this page exists to keep off the public internet. A count needs none
 * of it, so a count is all that ships.
 *
 * Everything else on the dashboard — the trend series, the load days, the week
 * buckets, the HR profile — is an aggregate over time with no geometry in it,
 * and passes through unchanged.
 */
export function publicDashboard<T extends { workouts: Array<{ day: string }> }>(
  dashboard: T | null | undefined,
): (Omit<T, 'workouts'> & { workouts: Array<{ day: string }> }) | null {
  if (!dashboard) return null;
  const { workouts, ...rest } = dashboard;
  return { ...rest, workouts: workouts.map((w) => ({ day: w.day })) };
}

/**
 * The segment form summary, reduced to its counts.
 *
 * Section F's four taxonomy tiles are counts over the whole corpus — improving,
 * holding, slipping, no form read — and say nothing about where any of that
 * ground is. The two things beside them do: `board` names five segments and
 * deep-links `/health/segments/{id}`, and `nearest` is the name the segment
 * tripwire quotes in section E. Both are dropped rather than blanked in the
 * template, so an anonymous browser is never sent them at all.
 */
export function publicSegmentForms<T extends { nearest: unknown; board: unknown[] }>(
  forms: T | null | undefined,
): (Omit<T, 'nearest' | 'board'> & { nearest: null; board: never[] }) | null {
  if (!forms) return null;
  const { nearest: _nearest, board: _board, ...rest } = forms;
  return { ...rest, nearest: null, board: [] };
}
