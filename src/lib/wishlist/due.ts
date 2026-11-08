// When an item is next worth checking. PURE.
//
// Hunts every six hours, tracked prices every two. From 20 November to 2
// December — Black Friday week and Cyber Monday — both go hourly, because that
// is when prices move and when a good deal sells out in an afternoon. An item
// whose deadline has passed stops being checked; it stays on the list until
// someone marks it bought or drops it.

import type { WishItem } from './types';

const HOUR = 3600_000;

export function inSaleSeason(now: Date): boolean {
  const m = now.getUTCMonth(); // 10 = November, 11 = December
  const d = now.getUTCDate();
  return (m === 10 && d >= 20) || (m === 11 && d <= 2);
}

export function cadenceMs(item: WishItem, now: Date): number {
  if (inSaleSeason(now)) return HOUR;
  return item.kind === 'hunt' ? 6 * HOUR : 2 * HOUR;
}

export function isDue(item: WishItem, now: Date): boolean {
  if (item.status !== 'watching') return false;
  if (item.deadline && now.toISOString().slice(0, 10) > item.deadline) return false;
  if (!item.lastCheckedAt) return true;
  // Five minutes of slack so a heartbeat tick landing just early still counts.
  return now.getTime() - Date.parse(item.lastCheckedAt) >= cadenceMs(item, now) - 5 * 60_000;
}

/** Web searches one item may make in a UTC day. */
export const SEARCHES_PER_DAY = 5;
const DAY = 24 * HOUR;

/** Searches already made today (UTC), as the item records them. */
export function searchesToday(item: WishItem, now: Date): number {
  return item.searches?.day === now.toISOString().slice(0, 10) ? item.searches.count : 0;
}

/**
 * How many web searches this check may make. The day's five are paced, not
 * spent at the first check: by any moment, the day may have used its share of
 * the time elapsed plus one cadence ahead. A six-hourly hunt makes 2+2+1 (or
 * so) across its checks; an hourly one in sale season about one every five
 * hours; a new item, checked late in the day, gets the day's remainder at once.
 */
export function searchesAllowed(item: WishItem, now: Date): number {
  const sinceMidnight = now.getTime() % DAY;
  const byNow = Math.ceil((SEARCHES_PER_DAY * (sinceMidnight + cadenceMs(item, now))) / DAY);
  return Math.max(0, Math.min(SEARCHES_PER_DAY, byNow) - searchesToday(item, now));
}
