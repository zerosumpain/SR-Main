// Client-safe scraps the three files of the Places room share.
//
// `PLACE_KINDS` also exists in `$lib/daydream/places.ts`, and this is not a
// careless second copy: that module imports `$lib/db`, so pulling the constant
// out of it would drag a Postgres client into the browser bundle. The server
// list carries an eighth value — `unknown`, what the clusterer writes before
// anybody has answered — which is deliberately not offered as an ANSWER here,
// exactly as the monolith's own seven-item list was not.

export const PLACE_KINDS = ['home', 'school', 'work', 'shop', 'cafe', 'gym', 'other'] as const;
export type PlaceKindChoice = (typeof PLACE_KINDS)[number];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The shape `rhythm` reads. Structural rather than the ledger's `LedgerPlace`,
 *  so the naming session's queue rows — a different, thinner payload from the
 *  API — can be described by the same sentence. */
export interface PlaceRhythm {
  visitCount: number;
  distinctDays?: number | null;
  medianDwellMins: number;
  dayHistogram?: number[] | null;
}

export function rhythm(p: PlaceRhythm): string {
  // Days first — that is what "keeps going there" means. Person-visits follow
  // only when they differ, because "5 visits across 1 day" is the whole
  // household in one car and reads as a habit if you show only the 5.
  const days = p.distinctDays ?? 0;
  const parts = days
    ? [`${days} day${days === 1 ? '' : 's'}`]
    : [`${p.visitCount} visit${p.visitCount === 1 ? '' : 's'}`];
  if (days && p.visitCount > days) parts.push(`${p.visitCount} visits`);
  if (p.medianDwellMins > 0) parts.push(`~${p.medianDwellMins} min`);
  const histogram = p.dayHistogram ?? [];
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total > 0) {
    const peak = histogram.indexOf(Math.max(...histogram));
    if (histogram[peak] / total >= 0.5 && histogram[peak] >= 2) {
      parts.push(`usually ${DAYS[peak]}`);
    }
  }
  return parts.join(' · ');
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
