// Binding a JS array into a raw `sql` template.
//
// Drizzle expands `sql`...ANY(${jsArray}::text[])`` into a comma-separated
// PARAMETER LIST — `ANY(($1, $2)::text[])` — which Postgres parses as a row
// constructor, not an array. Every such query dies at run time with
//
//   cannot cast type record to text[]
//
// and only when the array is non-empty, so it survives any test that passes an
// empty list and looks like a working query until it meets real data. It cost
// the nightly Gmail intel sweep every run from the day it shipped: the sweep
// listed its threads, hit this on the stored-hash lookup, and reported a bare
// error count with the message discarded.
//
// The fix is to bind ONE parameter holding a Postgres array literal and cast
// that. `$lib/datastore/query` already did this correctly and privately; this
// module is that implementation, moved somewhere the other subsystems can
// reach it, because the same defect had been re-derived wrongly in four places
// across three subsystems.
//
// Usage — note the interpolation is a plain string, so drizzle binds it as one
// parameter:
//
//   sql`WHERE id = ANY(${pgTextArray(ids)}::text[])`

/**
 * A `text[]` literal for `values`, to be bound as a single parameter and cast.
 *
 * Every element is quoted and backslash/quote-escaped, so values containing
 * `,` `{` `}` `"` or `\` survive the round trip intact.
 */
export function pgTextArray(values: readonly string[]): string {
  const quoted = values.map(
    (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
  );
  return `{${quoted.join(',')}}`;
}
