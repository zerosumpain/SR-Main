import { db } from '$lib/db';
import { whoopRecovery, whoopSleep, whoopCycles, appleHealthMetrics } from '$lib/db/schema';
import { gte, eq, and } from 'drizzle-orm';
import type { Correlation } from './series-30d-service';

const WINDOW_DAYS = 90;
const MIN_PAIRS = 4;

type DayRow = {
  date: string;
  rec: number | null;
  hrv: number | null;
  rhr: number | null;
  slept: number | null;
  strain: number | null;
  steps: number | null;
  sleepScore: number | null;
};

function isoDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export async function getCorrelations(): Promise<Correlation[]> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - WINDOW_DAYS * 86400;

  const [recoveryRows, sleepRows, cycleRows, stepRows] = await Promise.all([
    db
      .select()
      .from(whoopRecovery)
      .where(gte(whoopRecovery.createdDate, windowStart))
      .orderBy(whoopRecovery.createdDate),
    db
      .select()
      .from(whoopSleep)
      .where(and(gte(whoopSleep.startDate, windowStart - 86400), eq(whoopSleep.nap, false)))
      .orderBy(whoopSleep.startDate),
    db
      .select()
      .from(whoopCycles)
      .where(gte(whoopCycles.startDate, windowStart))
      .orderBy(whoopCycles.startDate),
    db
      .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
      .from(appleHealthMetrics)
      .where(
        and(
          gte(appleHealthMetrics.date, windowStart),
          eq(appleHealthMetrics.metricName, 'step_count'),
        ),
      ),
  ]);

  const days = new Map<string, DayRow>();
  function ensure(date: string): DayRow {
    let d = days.get(date);
    if (!d) {
      d = {
        date,
        rec: null,
        hrv: null,
        rhr: null,
        slept: null,
        strain: null,
        steps: null,
        sleepScore: null,
      };
      days.set(date, d);
    }
    return d;
  }

  for (const r of recoveryRows) {
    const d = ensure(isoDate(r.createdDate));
    d.rec = r.recoveryScore;
    d.hrv = r.hrvRmssd;
    d.rhr = r.restingHeartRate;
  }
  for (const s of sleepRows) {
    const d = ensure(isoDate(s.endDate));
    d.slept = (s.totalLight + s.totalSlowWave + s.totalRem) / 3600000;
    d.sleepScore = s.sleepPerformance;
  }
  for (const c of cycleRows) {
    const d = ensure(isoDate(c.startDate));
    // Same scale fix as the 30d series: legacy rows landed at strain*100.
    d.strain = c.strain > 22 ? c.strain / 100 : c.strain;
  }
  // Daily max — same reasoning as the 30d series loader.
  const stepsByDate = new Map<string, number>();
  for (const r of stepRows) {
    if (r.date == null || r.value == null) continue;
    const k = isoDate(r.date);
    const prior = stepsByDate.get(k) ?? 0;
    if (r.value > prior) stepsByDate.set(k, r.value);
  }
  for (const [k, v] of stepsByDate) ensure(k).steps = v;

  const ordered = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const ix: Record<string, number> = {};
  ordered.forEach((d, i) => {
    ix[d.date] = i;
  });

  const out: Correlation[] = [];

  // 1) Sleep <6h → next-day HRV vs all other nights' HRV
  {
    const shortAfter: number[] = [];
    const longAfter: number[] = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const today = ordered[i];
      const tomorrow = ordered[i + 1];
      if (today.slept == null || tomorrow.hrv == null) continue;
      if (today.slept < 6) shortAfter.push(tomorrow.hrv);
      else if (today.slept >= 7) longAfter.push(tomorrow.hrv);
    }
    if (shortAfter.length >= MIN_PAIRS && longAfter.length >= MIN_PAIRS) {
      const aShort = avg(shortAfter);
      const aLong = avg(longAfter);
      const pct = Math.round(((aShort - aLong) / aLong) * 100);
      out.push({
        cause: 'When I sleep <6h',
        effect: 'HRV drops',
        num: `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`,
        conf: `n=${shortAfter.length} short nights`,
      });
    }
  }

  // 2) Strain >14 → next-day recovery delta
  {
    const after: number[] = [];
    const baseline: number[] = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const today = ordered[i];
      const tomorrow = ordered[i + 1];
      if (today.strain == null || tomorrow.rec == null) continue;
      if (today.strain > 14) after.push(tomorrow.rec);
      else if (today.strain <= 10) baseline.push(tomorrow.rec);
    }
    if (after.length >= MIN_PAIRS && baseline.length >= MIN_PAIRS) {
      const delta = Math.round(avg(after) - avg(baseline));
      out.push({
        cause: 'After a strain >14 day',
        effect: 'Recovery is',
        num: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} pts`,
        conf: `n=${after.length} hard days`,
      });
    }
  }

  // 3) Steps >12k → next-night sleep score
  {
    const after: number[] = [];
    const baseline: number[] = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const today = ordered[i];
      const tomorrow = ordered[i + 1];
      if (today.steps == null || tomorrow.sleepScore == null) continue;
      if (today.steps > 12000) after.push(tomorrow.sleepScore);
      else if (today.steps < 8000) baseline.push(tomorrow.sleepScore);
    }
    if (after.length >= MIN_PAIRS && baseline.length >= MIN_PAIRS) {
      const delta = Math.round(avg(after) - avg(baseline));
      out.push({
        cause: 'After a 12k+ step day',
        effect: 'Sleep score',
        num: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} pts`,
        conf: `n=${after.length} active days`,
      });
    }
  }

  // 4) Sleep duration ↔ HRV (Pearson, same-day)
  {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const d of ordered) {
      if (d.slept != null && d.hrv != null && d.slept > 0 && d.hrv > 0) {
        xs.push(d.slept);
        ys.push(d.hrv);
      }
    }
    if (xs.length >= MIN_PAIRS) {
      const r = pearson(xs, ys);
      const sign = r >= 0 ? '+' : '−';
      const direction = r >= 0 ? 'tracks with' : 'inverts with';
      out.push({
        cause: 'Sleep hours',
        effect: `HRV ${direction}`,
        num: `r = ${sign}${Math.abs(r).toFixed(2)}`,
        conf: `n=${xs.length} pairs`,
      });
    }
  }

  return out.slice(0, 4);
}
