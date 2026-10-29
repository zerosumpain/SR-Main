// The owner's calendar day, shared by daydream's feature builder and chat's
// owner reads (overhaul plan 2026-10-28, P2-2). Moved from
// `$lib/daydream/features/build`, which re-exports it.

import { LOCAL_TZ } from '$lib/home/presence/types';

/** The Europe/London calendar day for an instant. */
export function localDay(d: Date, tz = LOCAL_TZ): string {
  // en-CA renders ISO-ordered YYYY-MM-DD, which is the only reason it is used
  // here — the alternative is hand-assembling parts and getting the padding
  // wrong.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * The local day for one of Apple's `date_local` strings.
 *
 * These already carry the local offset ("2026-08-26 08:20:47 +0100"), so the
 * date is the first ten characters and re-parsing would only introduce a chance
 * to shift it. Falls back to the epoch column when the string is malformed.
 */
export function appleLocalDay(dateLocal: string, epochSeconds: number): string {
  const head = dateLocal.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head)) return head;
  return localDay(new Date(epochSeconds * 1000));
}
