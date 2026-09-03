// src/lib/daydream/format.ts
//
// Time and figure formatting shared by every daydream room and the layout.
// PURE — no database, no `$lib/server` — so a component may import it. One
// copy, because the version that drifts is always the one that decides
// whether a timestamp reads "never" or "just now".

type Stamp = string | Date | null | undefined;

function ms(v: Stamp): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** How long ago, in words. `never` for a missing timestamp — "never ran" and
 *  "ran and found nothing" are different answers. */
export function ago(v: Stamp): string {
  const t = ms(v);
  if (t == null) return 'never';
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** A timestamp in EITHER direction: `in 3h`, `due`, `—`. `next_run_at` is
 *  usually in the future, and through `ago` it printed "-180m ago". */
export function when(v: Stamp): string {
  const t = ms(v);
  if (t == null) return '—';
  const mins = Math.round((t - Date.now()) / 60_000);
  if (mins <= 0) return 'due';
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

const STAMP_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** The absolute date and time, Europe/London: `Tue 2 Sep, 14:05`. */
export function stamp(v: Stamp): string {
  const t = ms(v);
  return t == null ? '' : STAMP_FMT.format(new Date(t));
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
