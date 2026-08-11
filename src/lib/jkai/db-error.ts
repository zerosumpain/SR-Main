/**
 * Say what the database actually objected to.
 *
 * Drizzle's error message is `Failed query: <sql>` followed by every bound
 * parameter. For an iteration write that is the whole transcript — 400KB of
 * dump on build 85dac418, roughly 2.4MB of log across seven failures — and the
 * reason is not in any of it. Postgres puts the reason on the driver error,
 * which Drizzle hangs off `err.cause`, so logging `err.message` produces an
 * error log with no error in it.
 *
 * That is why "the iteration write is failing" sat unexplained for a day: the
 * answer, SQLSTATE 22P05 on a NUL byte, was one property away the whole time.
 */

interface PgLikeError {
  code?: unknown;
  detail?: unknown;
  severity?: unknown;
  constraint_name?: unknown;
  column_name?: unknown;
  table_name?: unknown;
  message?: unknown;
}

/** Postgres SQLSTATEs worth naming in plain English at the point of failure. */
const KNOWN: Record<string, string> = {
  '22P05': 'the value contains a NUL byte (U+0000), which Postgres cannot store in text or jsonb',
  '22021': 'the value is not valid UTF-8',
  '23505': 'a unique constraint was violated',
  '23503': 'a foreign key constraint was violated',
  '23502': 'a NOT NULL column was given null',
  '22001': 'a value is longer than its column allows',
  '53100': 'the database is out of disk space',
  '57014': 'the statement was cancelled (timeout)',
  '08006': 'the connection to the database failed',
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/**
 * A one-line description: the SQLSTATE, what it means, and any detail —
 * without the parameter dump.
 */
export function describeDbError(err: unknown): string {
  const cause = (err as { cause?: unknown } | null)?.cause;
  const pg = (cause ?? err) as PgLikeError | null;

  const code = str(pg?.code);
  const detail = str(pg?.detail);
  const column = str(pg?.column_name);
  const table = str(pg?.table_name);
  const constraint = str(pg?.constraint_name);

  const parts: string[] = [];
  if (code) parts.push(KNOWN[code] ? `${code} — ${KNOWN[code]}` : code);

  // The driver's own message, but never Drizzle's: the latter is the query
  // plus every parameter, which is the thing this function exists to omit.
  const driverMessage = str(pg?.message);
  if (driverMessage && driverMessage !== str((err as Error)?.message)) {
    parts.push(truncate(driverMessage, 300));
  }
  if (detail) parts.push(truncate(detail, 300));
  if (table && column) parts.push(`at ${table}.${column}`);
  else if (constraint) parts.push(`constraint ${constraint}`);

  if (parts.length > 0) return parts.join(' · ');

  // No structured cause — fall back to the message, clipped hard so a
  // parameter dump cannot flood the log even in the unrecognised case.
  const fallback = str((err as Error)?.message) ?? String(err);
  return truncate(fallback, 400);
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
