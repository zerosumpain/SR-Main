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

export function searchDue(item: WishItem, now: Date): boolean {
  return !item.lastSearchedAt || now.getTime() - Date.parse(item.lastSearchedAt) >= 22 * HOUR;
}
