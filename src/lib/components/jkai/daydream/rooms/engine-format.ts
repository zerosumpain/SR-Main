// Formatting the engine room shares between its page and its four panels.
//
// In a module rather than repeated in each component for the reason `hub/
// types.ts` exists: a Svelte instance script is not something you can import
// out of, so a helper written there has to be written again everywhere it is
// used — and the version that drifts is always the one that decides whether a
// timestamp reads "never" or "just now".

/** How long ago, in words. `never` for a missing timestamp — the engine room's
 *  whole point is that "never ran" and "ran and found nothing" are different. */
export function ago(iso: string | Date | null | undefined): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * A timestamp in EITHER direction.
 *
 * `next_run_at` is usually in the future, and running it through `ago` prints
 * "-180m ago" — a negative age, which reads as a bug rather than as a
 * schedule. A next run already in the past is not an error either: it means
 * the tick is due and the heartbeat has not reached it yet, which is worth
 * saying plainly.
 */
export function when(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const mins = Math.round((t - Date.now()) / 60_000);
  if (mins <= 0) return 'due';
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

/** A cadence in seconds as the schedule reads it: `4h`, `30m`, `—`. */
export function cadence(secs: number | null | undefined): string {
  if (!secs) return '—';
  if (secs % 3600 === 0) return `${secs / 3600}h`;
  if (secs % 60 === 0) return `${secs / 60}m`;
  return `${secs}s`;
}

export function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`;
}

/** Cash, or null when there is none — an activity that cost nothing shows no
 *  corner at all rather than a `$0.00` that looks like a measurement. */
export function usd(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
