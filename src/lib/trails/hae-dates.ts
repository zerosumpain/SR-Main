// Health Auto Export date parsing — a dependency-free leaf, extracted from
// hae-workouts.ts so pure analytics (e.g. $lib/health/analytics/hrr) can parse
// HAE timestamps without transitively pulling hae-workouts' node:crypto import
// into a client bundle.

const HAE_DATE =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?$/;

/**
 * Parse HAE's "yyyy-MM-dd HH:mm:ss Z" into unix seconds.
 *
 * Parsed explicitly rather than handed to `new Date()`: the space-separated
 * form with a numeric offset is not in the ECMAScript date grammar, so engines
 * are free to disagree about it, and a silently-wrong timestamp would put a
 * workout on the wrong day without ever throwing.
 */
export function parseHaeDate(input: string | undefined | null): number | null {
  if (!input) return null;
  const m = HAE_DATE.exec(input.trim());
  if (!m) {
    // ISO 8601 with Z or an explicit offset is unambiguous — let the engine have it.
    const fallback = Date.parse(input);
    return Number.isNaN(fallback) ? null : Math.floor(fallback / 1000);
  }
  const [, y, mo, d, h, mi, s, offH, offM = '00'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const sign = offH.startsWith('-') ? -1 : 1;
  const offsetMinutes = sign * (Math.abs(+offH) * 60 + +offM);
  return Math.floor(utc / 1000) - offsetMinutes * 60;
}

/** The "+01:00" style offset HAE sent, kept so display can honour local time. */
export function extractOffset(input: string | undefined | null): string | null {
  if (!input) return null;
  const m = HAE_DATE.exec(input.trim());
  if (!m) return null;
  const [, , , , , , , offH, offM = '00'] = m;
  return `${offH}:${offM}`;
}
