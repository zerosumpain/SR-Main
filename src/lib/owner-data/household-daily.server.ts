// src/lib/owner-data/household-daily.server.ts
//
// Reading the household's health day by day for `household_daily`
// (`household-daily.ts` does the sums). Everyone the owner may see on
// /home/people, minus anyone not sharing (`insightMembers`), read live from
// the pilot as the patterns build and the digest do: steps through its daily
// records (two days a call), the rest through day timelines (a call a day).
// People are read side by side, each person's days one after another — the
// pilot is a small box.

import { pilotDay } from '$lib/home/presence/companion-accounts';
import { dayBounds } from '$lib/home/presence/day-timeline';
import { localClock } from '$lib/home/presence/forecast';
import { offsetOn } from '$lib/home/presence/forecast-digest.server';
import { dailyHealth, type HealthDay } from '$lib/home/presence/health-week';
import { insightMembers } from '$lib/home/presence/insights.server';
import { dailySteps } from '$lib/home/presence/patterns.server';
import { DAILY_METRICS, renderDaily, type DailyMetric, type DailyRow, type PersonDays } from './household-daily';

/** Steps cost a call per two days; the rest a call per day. */
export const MAX_DAYS: Record<DailyMetric, number> = { steps: 90, sleep: 31, workouts: 31, resting_hr: 31 };
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * The window's London dates, oldest first: `days` dates ending yesterday, or
 * today with `includeToday`, or `to` when given (never past today).
 */
export function windowDates(days: number, now: Date, opts: { includeToday?: boolean; to?: string | null } = {}): string[] {
  const today = localClock(now).date;
  let end = opts.includeToday ? today : addDays(today, -1);
  if (opts.to && ISO_DATE.test(opts.to) && opts.to < end) end = opts.to;
  return Array.from({ length: days }, (_, i) => addDays(end, i - days + 1));
}

const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export async function householdDailyTool(args: Record<string, unknown>, now = new Date()): Promise<{ label: string; text: string; rows: DailyRow[] }> {
  const metric = ((DAILY_METRICS as readonly string[]).includes(String(args.metric)) ? args.metric : 'steps') as DailyMetric;
  const asked = Number(args.days);
  const days = Math.max(1, Math.min(MAX_DAYS[metric], Number.isFinite(asked) && asked > 0 ? Math.round(asked) : 7));
  const includeToday = args.include_today === true || args.include_today === 'true';
  const to = typeof args.to === 'string' && args.to.trim() ? args.to.trim() : null;
  const dates = windowDates(days, now, { includeToday, to });
  const today = localClock(now).date;
  // Today's part day is shown beside a window that ends yesterday, for steps (it costs nothing extra).
  const showToday = metric === 'steps' && !dates.includes(today) && dates.at(-1) === addDays(today, -1);

  const q = typeof args.person === 'string' ? args.person.trim().toLowerCase() : '';
  const members = (await insightMembers({ kind: 'owner' })).filter(
    (m) => !q || m.subject.toLowerCase() === q || m.displayName.toLowerCase().startsWith(q),
  );
  if (q && !members.length) {
    const all = await insightMembers({ kind: 'owner' });
    return { label: 'Household health by day', text: `No one called "${args.person}". Name one of: ${all.map((m) => m.displayName).join(', ')}.`, rows: [] };
  }

  if (!members.length) {
    return { label: 'Household health by day', text: 'No one in the household shares their health with you here: no member is set up, or no one has sharing on in the app.', rows: [] };
  }

  const todayValues: Record<string, number | null> = {};
  const people: PersonDays[] = await Promise.all(members.map(async (m): Promise<PersonDays> => {
    const base = { subject: m.subject, name: m.displayName };
    if (!m.email) return { ...base, values: null, missing: 'no app account' };
    try {
      if (metric === 'steps') {
        // From the first date's London midnight (an hour spare) to now.
        const span = Math.ceil((+now - Date.parse(`${dates[0]}T00:00:00Z`)) / DAY_MS) + 1;
        const steps = await dailySteps(m.email, span, now);
        if (!steps) return { ...base, values: null, missing: 'no app account' };
        if (showToday) todayValues[m.subject] = steps.get(today) ?? null;
        return { ...base, values: Object.fromEntries(dates.map((d) => [d, steps.get(d) ?? null])) };
      }
      const read: HealthDay[] = [];
      for (const date of dates) {
        const tz = offsetOn(date);
        const [from, toS] = dayBounds(date, tz);
        const r = await pilotDay(m.email, { from, to: toS, tz });
        if (!r.ok) {
          if (r.reason === 'not-found') return { ...base, values: null, missing: 'no app account' };
          continue;
        }
        read.push({ date, from, to: toS, timeline: r.value.timeline });
      }
      const figures = dailyHealth(read);
      let sessions = 0;
      const values = Object.fromEntries(dates.map((d) => {
        const f = figures.get(d);
        if (!f) return [d, null];
        sessions += f.workouts;
        return [d, metric === 'sleep' ? f.sleepHours : metric === 'resting_hr' ? f.restingHeartRate : f.workoutMinutes];
      }));
      return { ...base, values, ...(metric === 'workouts' ? { sessions } : {}) };
    } catch (err) {
      return { ...base, values: null, missing: `could not be read: ${err instanceof Error ? err.message : String(err)}`.slice(0, 120) };
    }
  }));

  const { text, rows } = renderDaily({
    metric,
    dates,
    people,
    today: showToday ? { date: today, asOf: clockFmt.format(now), values: todayValues } : null,
  });
  return { label: 'Household health by day (from the SR app)', text, rows };
}
