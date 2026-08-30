// The calendar day the body's numbers are keyed to.
//
// Everything on /health buckets by LOCAL day: `startDateLocal` on an activity,
// the Monday `weeklyVolume` buckets to, the coach's plan cache key. Reading
// "today" out of `new Date().toISOString()` instead is correct for twenty-three
// hours a day and a day BEHIND for the hour between midnight and 01:00 BST —
// which is exactly when a page rebuilt after a late run compares today's date
// against yesterday's buckets and quietly reports the wrong week.
export const HEALTH_TIMEZONE = 'Europe/London';

/**
 * Today where the workouts happened, not where the server is — `YYYY-MM-DD`.
 *
 * `en-CA` is the locale whose short date IS the ISO calendar date, so this is a
 * zone conversion rather than a format-and-reparse. `now` is injectable so the
 * boundary hour is testable without moving the machine clock.
 */
export function localToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: HEALTH_TIMEZONE });
}
