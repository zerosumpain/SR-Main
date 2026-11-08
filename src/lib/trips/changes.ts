// src/lib/trips/changes.ts
//
// "What changed" between two plan versions, in words a person reads on the
// page and the phone, and the running-day rule from the phone wire contract:
// while a day is running the phone's version of that day wins, and a site edit
// that would have moved it is listed as "Changed on the site while you were
// out — …" instead. PURE.

import type { LocalDate, PlannedDay, PlannedStop, SolvedPlan } from './model';

export const SITE_WHILE_OUT = 'Changed on the site while you were out — ';

function hhmm(min: number): string {
  const m = Math.max(0, Math.round(min));
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "Mon 21 Oct" for a local date, without a time zone round trip. */
export function dayLabel(date: LocalDate): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function wishStops(plan: SolvedPlan): Map<string, { date: LocalDate; stop: PlannedStop; index: number }> {
  const out = new Map<string, { date: LocalDate; stop: PlannedStop; index: number }>();
  for (const day of plan.days) {
    day.stops.forEach((stop, index) => {
      if (stop.kind === 'wish' && stop.wishId) out.set(stop.wishId, { date: day.date, stop, index });
    });
  }
  return out;
}

/**
 * Human list of what moved from `prev` to `next`: wishes added, dropped,
 * moved to another day, or retimed by 15 minutes or more. Ordered by the next
 * plan's day order, then wish title, so the same pair always reads the same.
 */
export function diffPlans(prev: SolvedPlan | null, next: SolvedPlan, titles: Record<string, string> = {}): string[] {
  if (!prev) return ['First plan.'];
  const before = wishStops(prev);
  const after = wishStops(next);
  const name = (id: string, stop?: PlannedStop) => titles[id] ?? stop?.title ?? 'A wish';
  const lines: Array<{ key: string; text: string }> = [];

  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) {
      lines.push({ key: `${a.date}|${name(id, a.stop)}`, text: `${name(id, a.stop)} added on ${dayLabel(a.date)} at ${hhmm(a.stop.arriveMin)}.` });
    } else if (b.date !== a.date) {
      lines.push({
        key: `${a.date}|${name(id, a.stop)}`,
        text: `${name(id, a.stop)} moved from ${dayLabel(b.date)} to ${dayLabel(a.date)} (${hhmm(a.stop.arriveMin)}).`,
      });
    } else if (Math.abs(b.stop.arriveMin - a.stop.arriveMin) >= 15) {
      lines.push({
        key: `${a.date}|${name(id, a.stop)}`,
        text: `${name(id, a.stop)} now ${hhmm(a.stop.arriveMin)} instead of ${hhmm(b.stop.arriveMin)} on ${dayLabel(a.date)}.`,
      });
    }
  }
  for (const [id, b] of before) {
    if (after.has(id)) continue;
    const reason = next.dropped.find((d) => d.wishId === id)?.reason;
    lines.push({
      key: `~${b.date}|${name(id, b.stop)}`,
      text: `${name(id, b.stop)} is no longer planned${reason ? ` — ${reason}` : ''}.`,
    });
  }
  lines.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return lines.length ? lines.map((l) => l.text) : ['No change to the schedule.'];
}

/**
 * Keep the phone's version of a running day. `site` is the freshly solved
 * plan; `current` is the latest stored version, whose `date` day came from the
 * phone. Returns the plan to store (site plan with that day swapped back) and
 * the site's would-be changes to that day, prefixed with SITE_WHILE_OUT.
 */
export function keepRunningDay(
  site: SolvedPlan,
  current: SolvedPlan,
  date: LocalDate,
  titles: Record<string, string> = {},
): { plan: SolvedPlan; notes: string[] } {
  const phoneDay = current.days.find((d) => d.date === date);
  const siteDay = site.days.find((d) => d.date === date);
  if (!phoneDay || !siteDay) return { plan: site, notes: [] };
  const only = (day: PlannedDay): SolvedPlan => ({ days: [day], dropped: [], warnings: [], score: 0 });
  const notes = diffPlans(only(phoneDay), only(siteDay), titles)
    .filter((t) => t !== 'No change to the schedule.')
    .map((t) => SITE_WHILE_OUT + t);
  const plannedOnPhone = new Set(phoneDay.stops.map((s) => s.wishId).filter(Boolean));
  return {
    plan: {
      ...site,
      days: site.days.map((d) => (d.date === date ? phoneDay : d)),
      // A wish the site dropped but the phone still has today is not dropped.
      dropped: site.dropped.filter((d) => !plannedOnPhone.has(d.wishId)),
    },
    notes,
  };
}

/** Replace one day of a plan (option-applied from the phone). */
export function replaceDay(plan: SolvedPlan, day: PlannedDay): SolvedPlan {
  const has = plan.days.some((d) => d.date === day.date);
  const days = has ? plan.days.map((d) => (d.date === day.date ? day : d)) : [...plan.days, day].sort((a, b) => (a.date < b.date ? -1 : 1));
  const onDay = new Set(day.stops.map((s) => s.wishId).filter(Boolean));
  return { ...plan, days, dropped: plan.dropped.filter((d) => !onDay.has(d.wishId)) };
}
