// Drizzle's query errors embed the full SQL and every bound parameter — for a
// route insert that is thousands of coordinates, and exactly what ended up
// rendered on screen when a save failed. The pg error underneath says what
// actually went wrong in one line; surface that, log the rest server-side.

export function describeSaveError(err: unknown): string {
  const cause = (err as { cause?: { message?: string } } | null)?.cause;
  const detail =
    (typeof cause?.message === 'string' && cause.message) ||
    (err instanceof Error ? err.message : 'unknown error');
  // A validation message ("A route needs at least two points") passes through
  // untouched; a query dump gets cut at the first line and capped.
  return detail.split('\n')[0].slice(0, 200);
}
