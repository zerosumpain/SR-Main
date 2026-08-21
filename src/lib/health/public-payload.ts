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

/**
 * The only keys an anonymous visitor receives.
 *
 * Every one of these is an aggregate body metric or already-published copy.
 * Adding a key here is a deliberate, reviewable act — which is the point.
 */
export const PUBLIC_FIELDS = [
  'series', // 30 days of daily numbers — no timestamps, no places
  'today',
  'yesterday',
  'headline',
  'strap',
  'rhrBaseline',
  'rings',
  'todayDeltas',
  'syncedAgoSeconds',
  'narrative',
  'annotations',
  'provenance',
  'readiness',
  'trainingLoad',
  'vo2max',
  'sleepRegularity',
  'stats',
  'featuredActivities',
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
 * `featuredActivities` is the one carve-out and it is deliberate: those rows are
 * opt-in, flagged `featured` by hand on `strava_activities`, and the page has
 * shown their routes publicly since it launched. Everything under this key is
 * skipped by the walker below; nothing else is.
 */
const DISCLOSURE_EXEMPT_ROOTS = new Set(['featuredActivities']);

/** Keys that carry a route, wherever they appear. */
const GEOMETRY_KEYS = /^(polyline|coordinates|coords|bounds|latlng|lat|lng|lon|longitude|latitude)$/i;

/** Keys that name a specific outing or a specific piece of ground. */
const IDENTITY_KEYS = /^(segmentName|segmentId|activityId|startDateLocal|timezone|track)$/i;

/** A `YYYY-MM-DD hh:mm` local stamp — the clock John was out at. */
const LOCAL_TIMESTAMP = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;

/** A what3words-style segment name: three lowercase words joined by dots. */
const SEGMENT_NAME = /^[a-z]+\.[a-z]+\.[a-z]+$/;

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
      if (LOCAL_TIMESTAMP.test(node)) found.push(`${at}: local timestamp`);
      else if (SEGMENT_NAME.test(node)) found.push(`${at}: segment name`);
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
        !Number.isInteger(node[0]) &&
        !Number.isInteger(node[1])
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
      if (child != null && (GEOMETRY_KEYS.test(key) || IDENTITY_KEYS.test(key))) {
        found.push(`${childPath}: ${key}`);
        continue;
      }
      walk(child, childPath, depth + 1);
    }
  };

  walk(value, path, 0);
  return found;
}
