// One sorting rule for every list on the health hub.
//
// NULLS SINK, THEY DO NOT VANISH. A walk with no heart rate still happened,
// and a segment covered twice still exists — so a row with no value in the
// sorted column goes to the BOTTOM in both directions rather than dropping out
// of the table or being promoted to the top when the arrow flips.
//
// Extracted from activity-list.ts when /health/segments joined the redesign
// (2026-08-30) and needed the identical rule over a different row type. Lifted
// rather than copied, for the reason segments/form.ts gives about itself: one
// implementation, so two surfaces cannot disagree about what "sorted" means.
// It lives in its own module rather than in activity-list for the same reason
// $lib/health/popover does — a segments module importing "activity-list" for a
// rule that has nothing to do with activities is the dependency pointing the
// wrong way.

export interface ListSort<K extends string> {
  key: K;
  dir: 'asc' | 'desc';
}

/**
 * A comparator for one active sort at a time.
 *
 * `valueOf` returns the column's sortable value — a string compares as text, a
 * number as a number, `null` sinks. `tiebreak` decides equal values and is the
 * whole order when nothing is sorted, so it must be total: two rows that tie on
 * it as well would otherwise reorder themselves between renders.
 */
export function nullsSinkComparator<T, K extends string>(
  sort: ListSort<K> | null,
  valueOf: (row: T, key: K) => number | string | null,
  tiebreak: (a: T, b: T) => number,
): (a: T, b: T) => number {
  if (!sort) return tiebreak;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return (a, b) => {
    const va = valueOf(a, sort.key);
    const vb = valueOf(b, sort.key);
    if (va == null && vb == null) return tiebreak(a, b);
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp =
      typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb)
        : Number(va) - Number(vb);
    return cmp * dir || tiebreak(a, b);
  };
}
