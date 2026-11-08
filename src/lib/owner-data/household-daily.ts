// src/lib/owner-data/household-daily.ts
//
// The household's health day by day, for chat's `household_daily`: one
// metric, a window of London dates, every person's value on each date and the
// arithmetic done here, not by the model — mean, median, total, best and
// lowest day, the ranking and the gap between the top two. Owner, 2026-11-01:
// questions like "who has the most average steps over the last 6 days" must be
// answered from the figures, and a model adding up a column is how a wrong
// leader gets named. PURE — `household-daily.server.ts` reads the pilot.
//
// A date with no reading is missing, never zero: a phone left at home is not
// a day of no steps. Workouts are the exception: a day the pilot answered with
// none had none.

export const DAILY_METRICS = ['steps', 'sleep', 'workouts', 'resting_hr'] as const;
export type DailyMetric = (typeof DAILY_METRICS)[number];

const METRIC: Record<DailyMetric, { title: string; unit: string; per: string; lowerIsBetter?: boolean; byTotal?: boolean }> = {
  steps: { title: 'STEPS', unit: 'steps', per: 'a day' },
  sleep: { title: 'SLEEP (hours asleep in the night ending on each date)', unit: 'h', per: 'a night' },
  workouts: { title: 'WORKOUT MINUTES', unit: 'min', per: 'a day', byTotal: true },
  resting_hr: { title: 'RESTING HEART RATE', unit: 'bpm', per: 'a day', lowerIsBetter: true },
};

export interface PersonDays {
  subject: string;
  name: string;
  /** Date → value; a date absent or null had no reading. Null: nothing could be read for them. */
  values: Record<string, number | null> | null;
  /** Why `values` is null, in words. */
  missing?: string;
  /** Workouts only: how many sessions. */
  sessions?: number;
}

export interface DailyStats {
  n: number;
  mean: number;
  median: number;
  total: number;
  max: { value: number; date: string };
  min: { value: number; date: string };
}

export interface DailyRow {
  rank: number;
  name: string;
  /** Days with a reading, of the window's dates. */
  days: number;
  of: number;
  mean: number;
  median: number;
  total: number;
  best: { value: number; date: string };
  lowest: { value: number; date: string };
  sessions?: number;
}

export function statsOf(values: Record<string, number | null>, dates: readonly string[]): DailyStats | null {
  const xs = dates.flatMap((d) => (values[d] != null && Number.isFinite(values[d]) ? [{ d, v: values[d] as number }] : []));
  if (!xs.length) return null;
  const sorted = xs.map((x) => x.v).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const total = sorted.reduce((a, b) => a + b, 0);
  // Ties go to the earlier date, so the answer does not move between asks.
  const max = xs.reduce((a, b) => (b.v > a.v ? b : a));
  const min = xs.reduce((a, b) => (b.v < a.v ? b : a));
  return {
    n: xs.length,
    mean: total / xs.length,
    median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    total,
    max: { value: max.v, date: max.d },
    min: { value: min.v, date: min.d },
  };
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
export const dayLabel = (date: string) => dayFmt.format(new Date(`${date}T12:00:00Z`));

function fmt(metric: DailyMetric, n: number): string {
  if (metric === 'sleep') return (Math.round(n * 10) / 10).toFixed(1);
  return Math.round(n).toLocaleString('en-GB');
}

/** The ranked rows: by mean, or by total for workouts; lowest first for resting heart rate. */
export function rankDaily(metric: DailyMetric, people: readonly PersonDays[], dates: readonly string[]): DailyRow[] {
  const m = METRIC[metric];
  const rows = people.flatMap((p) => {
    const s = p.values ? statsOf(p.values, dates) : null;
    if (!s) return [];
    const row: Omit<DailyRow, 'rank'> = { name: p.name, days: s.n, of: dates.length, mean: s.mean, median: s.median, total: s.total, best: s.max, lowest: s.min, ...(p.sessions != null ? { sessions: p.sessions } : {}) };
    return [row];
  });
  const key = (r: Omit<DailyRow, 'rank'>) => (m.byTotal ? r.total : r.mean);
  rows.sort((a, b) => (m.lowerIsBetter ? key(a) - key(b) : key(b) - key(a)) || a.name.localeCompare(b.name));
  // Equal figures share a rank.
  let rank = 0;
  return rows.map((r, i) => {
    if (i === 0 || key(r) !== key(rows[i - 1])) rank = i + 1;
    return { ...r, rank };
  });
}

export interface DailyRead {
  metric: DailyMetric;
  dates: string[];
  people: PersonDays[];
  /** Today's figure so far, when today is not in `dates`: subject → value. */
  today?: { date: string; asOf: string; values: Record<string, number | null> } | null;
}

/** The tool's text: the ranking with its sums, then every person's every date. */
export function renderDaily(read: DailyRead): { text: string; rows: DailyRow[] } {
  const { metric, dates, people } = read;
  const m = METRIC[metric];
  const rows = rankDaily(metric, people, dates);
  const window = dates.length === 1 ? dayLabel(dates[0]) : `${dates.length} days, ${dayLabel(dates[0])} to ${dayLabel(dates.at(-1)!)}`;
  const out = [
    `${m.title} — ${window} (London dates${read.today ? '; today is not in the window, see below' : ''}). From the SR app's Apple Health uploads, the same source for everyone.`,
    m.byTotal
      ? 'A day the app answered with no workout counts as 0.'
      : 'Means count only the days with a reading: a missing day is NOT zero, so check "days" before comparing people.',
  ];
  if (rows.length) {
    out.push(m.byTotal ? 'Ranked by total:' : `Ranked by mean${m.lowerIsBetter ? ', lowest first (lower is usually fitter)' : ''}:`);
    for (const r of rows) {
      const lead = m.byTotal
        ? `${fmt(metric, r.total)} ${m.unit} in all${r.sessions != null ? ` over ${r.sessions} workouts` : ''}, mean ${fmt(metric, r.mean)} ${m.per}`
        : `mean ${fmt(metric, r.mean)} ${m.unit} ${m.per} over ${r.days} of ${r.of} days; total ${fmt(metric, r.total)}; median ${fmt(metric, r.median)}`;
      out.push(`  ${r.rank}. ${r.name}: ${lead}; highest ${fmt(metric, r.best.value)} (${dayLabel(r.best.date)}), lowest ${fmt(metric, r.lowest.value)} (${dayLabel(r.lowest.date)}).`);
    }
    if (rows.length > 1) {
      const key = (r: DailyRow) => (m.byTotal ? r.total : r.mean);
      const [a, b] = rows;
      const gap = Math.abs(key(a) - key(b));
      const pct = key(b) !== 0 ? Math.round((gap / Math.abs(key(b))) * 100) : null;
      const all = rows.reduce((s, r) => s + key(r), 0) / rows.length;
      out.push(`${a.rank === b.rank ? `${a.name} and ${b.name} tie` : `${a.name} leads ${b.name} by ${fmt(metric, gap)} ${m.unit}${pct != null ? ` (${pct}%)` : ''}`}. Household average of the ${m.byTotal ? 'totals' : 'means'}: ${fmt(metric, all)} ${m.unit}.`);
    }
  } else {
    out.push('No one has a reading in this window.');
  }
  const named = people.filter((p) => p.values);
  if (named.length) {
    out.push(`Day by day (${named.map((p) => p.name).join(' | ')}; – is no reading):`);
    for (const d of dates) out.push(`  ${dayLabel(d)}: ${named.map((p) => (p.values![d] != null ? fmt(metric, p.values![d]!) : '–')).join(' | ')}`);
  }
  if (read.today && named.length) {
    const t = named.map((p) => `${p.name} ${read.today!.values[p.subject] != null ? fmt(metric, read.today!.values[p.subject]!) : '–'}`);
    out.push(`Today so far (${dayLabel(read.today.date)}, to ${read.today.asOf}; a part day, not in the figures above): ${t.join('; ')}.`);
  }
  const gone = people.filter((p) => !p.values);
  if (gone.length) out.push(`Not readable: ${gone.map((p) => `${p.name} (${p.missing ?? 'no app health'})`).join('; ')}.`);
  return { text: out.join('\n'), rows };
}
