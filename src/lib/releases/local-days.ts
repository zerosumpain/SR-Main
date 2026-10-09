// local-days.ts — deploys per day in the owner's day (Europe/London), for the
// landing sentence. The release record buckets by UTC day, which is right for
// the /releases charts but a day out for the hour after midnight BST, when the
// landing page's London dateline already says tomorrow and "shipped N today"
// would still be counting yesterday's deploys. Pure, so the boundary is a test.

import { localToday } from '$lib/constants/health-day';

export interface LocalDayCount {
  /** YYYY-MM-DD, a London calendar day. */
  date: string;
  count: number;
}

const DAY_MS = 86_400_000;

/**
 * Every London day from the first deploy's to the last's, oldest first, with
 * quiet days present as zeroes so a caller can index by position.
 */
export function localDayCadence(deployedAt: Array<Date | string>): LocalDayCount[] {
  const counts = new Map<string, number>();
  for (const at of deployedAt) {
    const t = new Date(at);
    if (!Number.isFinite(t.getTime())) continue;
    const key = localToday(t);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (!counts.size) return [];
  const keys = [...counts.keys()].sort();
  const out: LocalDayCount[] = [];
  // Walk calendar keys at UTC noon, which never crosses a key on a clock change.
  const end = Date.parse(`${keys.at(-1)}T12:00:00Z`);
  for (let t = Date.parse(`${keys[0]}T12:00:00Z`); t <= end; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    out.push({ date, count: counts.get(date) ?? 0 });
  }
  return out;
}
