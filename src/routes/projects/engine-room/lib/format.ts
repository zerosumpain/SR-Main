// format.ts — how a figure reads on the page. A live count that couldn't be fetched is a
// dash, never a zero: a zero is a claim, a dash says we don't know.

export const DASH = '—';

export const num = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? DASH : v.toLocaleString('en-GB');

export const pct = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? DASH : `${Math.round(v * 100)}%`;

/** "45 min", "6 h", "1 day" — for cadences read from the heartbeat registry. */
export function every(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? 'daily' : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'hourly' : `every ${minutes / 60} h`;
  return `every ${minutes} min`;
}

/** `snake_case` / `kebab-case` identifier → words, for ids with no copy of their own. */
export const words = (id: string): string => id.replace(/[_-]+/g, ' ');
