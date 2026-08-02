// The timezone user-facing cron schedules are interpreted in.
//
// WHY THIS EXISTS
// ---------------
// `new Cron(expr)` with no options uses the SERVER's local time. The VPS runs
// `Etc/UTC` and sets no `TZ`, so every schedule registered without an explicit
// timezone fired in UTC — an hour late through British Summer Time, and
// shifting by an hour at each DST boundary.
//
// That was already wrong on its own, but it was also a lie: the canvas UI
// renders cron details as `Timezone: Europe/London` (node-summary.ts), and
// `workflow_add_schedule` accepts a `timezone` in its config which nothing read.
// Every other scheduler in the codebase — briefing, selfimprove, workflowdoctor,
// connectors, model routing — already passes `{ timezone: 'Europe/London' }`.
// Only the two schedulers driven by user-created rows did not.
//
// Found 2026-08-02: `canvas:daily-spend-summary` on `0 20 * * *` did not fire at
// 19:00 UTC (when a Europe/London schedule would have) and instead fired at
// 20:00 UTC — 21:00 the owner's time.
//
// Europe/London rather than a server setting: these schedules are written by
// and for one person in the UK, and "20:00" in a canvas means their 20:00.

/** Default for a schedule that does not name its own timezone. */
export const DEFAULT_CRON_TZ = 'Europe/London';

/**
 * Resolve the timezone for a schedule's stored config.
 *
 * An unrecognised zone would make `new Cron` throw and take the whole schedule
 * down, so anything Intl does not accept falls back to the default rather than
 * killing registration. A schedule running an hour out beats one not running.
 */
export function cronTimezone(config: unknown): string {
  const raw = (config as { timezone?: unknown } | null | undefined)?.timezone;
  const tz = typeof raw === 'string' ? raw.trim() : '';
  if (!tz) return DEFAULT_CRON_TZ;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return tz;
  } catch {
    console.warn(`[scheduler] unknown timezone "${tz}" — falling back to ${DEFAULT_CRON_TZ}`);
    return DEFAULT_CRON_TZ;
  }
}
