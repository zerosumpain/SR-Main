// Facts about an activity that live outside its own columns.
//
// Two jobs, both of which have already gone wrong once elsewhere in this repo:
//
//  1. The owner's TYPE CORRECTION. `activities.activity_type` holds what the
//     source said, and ingest upserts it on every sync — so a correction stored
//     there is clobbered the next time the phone posts. The correction lives in
//     `type_override` and every reader goes through effectiveType().
//
//  2. HAE metadata units FOLLOW THE PHONE, even inside the `metadata` jsonb.
//     Temperature can arrive as degF. A number read without its units is a
//     number that is silently wrong for half the year, so anything whose units
//     are not recognised is DROPPED rather than assumed.

/** The normalised types ingest produces, plus the label the owner picks from. */
export const ACTIVITY_TYPES = [
  'run',
  'trail_run',
  'ride',
  'mtb',
  'hike',
  'walk',
  'swim',
  'other',
] as const;

export type ActivityTypeName = (typeof ACTIVITY_TYPES)[number];

export function isKnownActivityType(t: string): t is ActivityTypeName {
  return (ACTIVITY_TYPES as readonly string[]).includes(t);
}

/**
 * The type everything downstream should read: the owner's correction if there
 * is one, otherwise what the source said.
 */
export function effectiveType(a: {
  activityType: string;
  typeOverride?: string | null;
}): string {
  const override = a.typeOverride?.trim();
  return override ? override : a.activityType;
}

type Meta = Record<string, unknown> | null | undefined;

function quantity(q: unknown): { qty: number; units: string } | null {
  if (typeof q === 'number') return Number.isFinite(q) ? { qty: q, units: '' } : null;
  if (!q || typeof q !== 'object') return null;
  const { qty, units } = q as { qty?: unknown; units?: unknown };
  if (typeof qty !== 'number' || !Number.isFinite(qty)) return null;
  return { qty, units: typeof units === 'string' ? units.trim().toLowerCase() : '' };
}

/**
 * Ambient temperature in °C, or null.
 *
 * HAE temperature follows the phone's units — a Fahrenheit phone sends degF.
 * This is the single implementation; `physio-service` imports it rather than
 * keeping the private copy it used to carry, so the activity page and the
 * hottest-ride ranking can never disagree about what 68° meant.
 */
export function celsiusFrom(v: unknown): number | null {
  const q = quantity(v);
  if (!q) return null;
  const c = /f/i.test(q.units) ? ((q.qty - 32) * 5) / 9 : q.qty;
  return Math.round(c * 10) / 10;
}

/** Ambient temperature of an activity, read out of its `metadata` jsonb. */
export function temperatureC(metadata: Meta): number | null {
  return celsiusFrom((metadata as Record<string, unknown> | null)?.temperature);
}

export function humidityPct(metadata: Meta): number | null {
  return quantity((metadata as Record<string, unknown> | null)?.humidity)?.qty ?? null;
}

/**
 * Whether the workout was recorded indoors.
 *
 * Absent metadata is `null`, not `false` — "we do not know" and "we know it was
 * outside" pick different activities out of a hottest-day ranking.
 */
export function isIndoor(metadata: Meta): boolean | null {
  const v = (metadata as Record<string, unknown> | null)?.isIndoor;
  if (typeof v === 'boolean') return v;
  const loc = (metadata as Record<string, unknown> | null)?.location;
  if (typeof loc === 'string') {
    const l = loc.trim().toLowerCase();
    if (l === 'indoor') return true;
    if (l === 'outdoor') return false;
  }
  return null;
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

/**
 * The clock time the workout actually started, read from the string the phone
 * sent rather than through a Date.
 *
 * Workout days are LOCAL and servers are UTC — reinterpreting `startDateLocal`
 * through the server's zone slides a 00:30 BST run into the previous day, which
 * is exactly how an "earliest ever start" ends up being a late-night one.
 */
export function localParts(
  startDateLocal: string,
): { day: string; hour: number; minute: number; minutesOfDay: number } | null {
  const m = LOCAL_RE.exec((startDateLocal ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const hour = Number(h);
  const minute = Number(mi);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return {
    day: `${y}-${mo}-${d}`,
    hour,
    minute,
    minutesOfDay: hour * 60 + minute,
  };
}

/** Local calendar day (`YYYY-MM-DD`) of an activity, or null when unparseable. */
export function localDay(startDateLocal: string): string | null {
  return localParts(startDateLocal)?.day ?? null;
}

/** Minutes past local midnight, or null. */
export function localMinutesOfDay(startDateLocal: string): number | null {
  return localParts(startDateLocal)?.minutesOfDay ?? null;
}

/** `07:24` from the stored local string, without a timezone round-trip. */
export function formatLocalClock(startDateLocal: string): string {
  const p = localParts(startDateLocal);
  if (!p) return '—';
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function formatTemperature(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return '—';
  return `${c.toFixed(1)}°C`;
}
