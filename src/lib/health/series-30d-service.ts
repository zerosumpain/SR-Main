import { db } from '$lib/db';
import {
  whoopRecovery,
  whoopSleep,
  whoopCycles,
  whoopWorkouts,
  appleHealthMetrics,
} from '$lib/db/schema';
import { gte, eq, and, desc } from 'drizzle-orm';

export type HealthDay = {
  i: number;
  date: string;
  rec: number;
  hrv: number;
  rhr: number;
  slept: number;
  strain: number;
  steps: number;
  weight: number;
  sleepStages?: { deep: number; rem: number; light: number; awake: number };
  sleepStart?: string;
  sleepEnd?: string;
  sleepScore?: number;
};

export type Workout = { day: string; name: string; strain: number; dur: string };

export type Correlation = { cause: string; effect: string; num: string; conf: string };

export type HealthSeriesData = {
  series: HealthDay[];
  today: HealthDay;
  yesterday: HealthDay;
  workouts: Workout[];
  correlations: Correlation[];
  narrative: { tag: string; text: string };
  headline: { primary: string; ghost: string };
  strap: string;
  todayDeltas: {
    recDelta: number;
    hrvDeltaPct: number;
    rhrDelta: number;
    sleepDelta: number;
  };
  syncedAgoSeconds: number;
};

const DAYS = 30;

function isoDate(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

function startOfTodayUnix(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function emptyDay(i: number, date: string): HealthDay {
  return {
    i,
    date,
    rec: 0,
    hrv: 0,
    rhr: 0,
    slept: 0,
    strain: 0,
    steps: 0,
    weight: 0,
  };
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function dayTag(date: Date, today: Date): string {
  const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
  if (diff === 0) return 'TDY';
  if (diff === 1) return 'YST';
  return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][date.getDay()];
}

function fmtDur(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rest = m - h * 60;
    return rest ? `${h}h ${rest}m` : `${h}h`;
  }
  return `${m}m`;
}

function pickHeadline(rec: number): { primary: string; ghost: string } {
  if (rec < 40) return { primary: "WRECKED.", ghost: "DON'T LIFT." };
  if (rec < 55) return { primary: "MEH.", ghost: "WALK IT OFF." };
  if (rec < 70) return { primary: "HOLD STEADY.", ghost: "STEADY HANDS." };
  if (rec < 85) return { primary: "READY.", ghost: "GO MOVE." };
  return { primary: "RECOVERED.", ghost: "BUILD SOMETHING." };
}

function buildStrap(today: HealthDay, yesterday: HealthDay): string {
  if (yesterday.hrv === 0 || today.hrv === 0) {
    return `Recovery's at ${today.rec}%. HRV ${today.hrv}ms, RHR ${today.rhr}bpm. Body's reporting in.`;
  }
  const hrvDelta = Math.round(((yesterday.hrv - today.hrv) / yesterday.hrv) * 100);
  const direction = hrvDelta > 0 ? 'dropped' : 'climbed';
  const baselineDelta = today.rhr - 58;
  const rhrLine =
    baselineDelta > 0
      ? `Heart rate's still ${baselineDelta} bpm above baseline.`
      : baselineDelta < 0
        ? `Heart rate's ${Math.abs(baselineDelta)} bpm below baseline.`
        : `Heart rate's at baseline.`;
  return `Recovery's at ${today.rec}%. HRV ${direction} ${Math.abs(hrvDelta)}% overnight after yesterday's session. ${rhrLine} The body is asking, politely, for a walk and a sandwich.`;
}

function buildNarrative(series: HealthDay[]): { tag: string; text: string } {
  const last7 = series.slice(-7);
  const today = series[series.length - 1];
  const sortedByStrain = [...last7].sort((a, b) => b.strain - a.strain);
  const hardest = sortedByStrain[0];
  const lowestHrv = [...last7].sort((a, b) => a.hrv - b.hrv)[0];
  const avgRec = Math.round(avg(last7.map((d) => d.rec)));
  const weightDelta = +(today.weight - series[0].weight).toFixed(1);

  const hardestDay = new Date(hardest.date).toLocaleString('en', {
    weekday: 'long',
  });
  const recBand = today.rec < 40 ? 'red' : today.rec < 67 ? 'amber' : 'green';

  let text = `You went hard on ${hardestDay}. <em>Strain ${hardest.strain.toFixed(1)}</em>. `;
  if (lowestHrv.hrv > 0 && lowestHrv.hrv < 45) {
    text += `HRV cratered to <em>${lowestHrv.hrv}ms</em> — your worst this window. `;
  }
  text += `Week's average recovery sits at <em>${avgRec}%</em> and today is still <em>${recBand}</em>. `;
  if (Math.abs(weightDelta) > 0.3 && today.weight > 0) {
    const dir = weightDelta < 0 ? '−' : '+';
    text += `Weight's moved <em>${dir}${Math.abs(weightDelta).toFixed(1)} kg</em> over the window. `;
  }
  text += today.rec < 50 ? `The sandwich is earned.` : `Plenty of rope left.`;

  return { tag: 'THIS WEEK · IN PLAIN ENGLISH', text };
}

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildMockSeries(): HealthDay[] {
  const r = rng(7);
  const out: HealthDay[] = [];
  const todayUnix = startOfTodayUnix();
  const windowStart = todayUnix - (DAYS - 1) * 86400;
  for (let i = 0; i < DAYS; i++) {
    const dayUnix = windowStart + i * 86400;
    const weekend = i % 7 === 5 || i % 7 === 6;
    const slept = 6.2 + r() * 2.1 + (weekend ? 0.6 : 0);
    const hrv = Math.round(38 + r() * 28 - (slept < 7 ? 8 : 0));
    const rhr = Math.round(58 - (hrv - 50) * 0.18 + r() * 4);
    const rec = Math.max(
      12,
      Math.min(99, Math.round(40 + (hrv - 40) * 1.4 + (slept - 7) * 6 + r() * 8)),
    );
    const strain = +(weekend ? 6 + r() * 6 : 11 + r() * 7).toFixed(1);
    const steps = Math.round(4000 + r() * 9000 + (weekend ? 2000 : 0));
    const weight = +(78.4 - i * 0.04 + (r() - 0.5) * 0.6).toFixed(1);
    out.push({
      i,
      date: isoDate(dayUnix),
      rec,
      hrv,
      rhr,
      slept: +slept.toFixed(2),
      strain,
      steps,
      weight,
    });
  }
  // Force today to be a "wrecked" day for the joke
  const t = out[DAYS - 1];
  t.slept = 5.6;
  t.hrv = 31;
  t.rhr = 64;
  t.rec = 28;
  t.strain = 4.2;
  t.steps = 3120;
  t.sleepStages = { deep: 42, rem: 58, light: 214, awake: 22 };
  t.sleepScore = 54;
  t.sleepStart = '23:48';
  t.sleepEnd = '05:24';
  // Yesterday: a hard workout
  const y = out[DAYS - 2];
  y.strain = 18.3;
  y.steps = 13442;
  return out;
}

function buildMockWorkouts(): Workout[] {
  return [
    { day: 'YST', name: 'Hill repeats · Heath', strain: 18.3, dur: '72m' },
    { day: 'SUN', name: 'Easy run', strain: 9.4, dur: '38m' },
    { day: 'SAT', name: 'Strength · push', strain: 12.1, dur: '54m' },
    { day: 'THU', name: 'Tempo run', strain: 14.8, dur: '46m' },
    { day: 'WED', name: 'Strength · pull', strain: 11.7, dur: '52m' },
  ];
}

const STATIC_CORRELATIONS: Correlation[] = [
  { cause: 'When I sleep <6h', effect: 'HRV drops', num: '−21%', conf: 'r = −0.74 · n=12' },
  { cause: 'When I drink', effect: 'Recovery is', num: '−18 pts', conf: 'r = −0.68 · n=8' },
  {
    cause: 'Strain >16 days',
    effect: 'Need',
    num: '2 days',
    conf: 'observed 4/4',
  },
  {
    cause: 'After a 12k+ step day',
    effect: 'Sleep score',
    num: '+11 pts',
    conf: 'r = +0.52 · n=14',
  },
];

async function getWorkouts(now: number): Promise<Workout[]> {
  const sevenDaysAgo = now - 7 * 86400;
  const today = new Date();

  const rows = await db
    .select({
      startDate: whoopWorkouts.startDate,
      sportName: whoopWorkouts.sportName,
      strain: whoopWorkouts.strain,
      endDate: whoopWorkouts.endDate,
    })
    .from(whoopWorkouts)
    .where(gte(whoopWorkouts.startDate, sevenDaysAgo))
    .orderBy(desc(whoopWorkouts.startDate))
    .limit(5);

  return rows.map((r) => {
    const date = new Date(r.startDate * 1000);
    return {
      day: dayTag(date, today),
      name: r.sportName || 'Activity',
      strain: +(r.strain || 0).toFixed(1),
      dur: fmtDur(r.endDate - r.startDate),
    };
  });
}

export async function getHealthSeries30d(): Promise<HealthSeriesData> {
  const todayStart = startOfTodayUnix();
  const windowStart = todayStart - (DAYS - 1) * 86400;

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
      )
      .orderBy(appleHealthMetrics.date),
  ]);

  // Index by ISO date (UTC midnight)
  const recByDate = new Map<string, (typeof recoveryRows)[number]>();
  for (const r of recoveryRows) recByDate.set(isoDate(r.createdDate), r);

  const sleepByDate = new Map<string, (typeof sleepRows)[number]>();
  for (const s of sleepRows) {
    // Anchor sleep to the wake date (endDate)
    sleepByDate.set(isoDate(s.endDate), s);
  }

  const cycleByDate = new Map<string, (typeof cycleRows)[number]>();
  for (const c of cycleRows) cycleByDate.set(isoDate(c.startDate), c);

  // apple_health_metrics.value is stored as value * 100 (per ingest endpoint).
  // Divide by 100 before aggregating so pulse-grid normalisation lands in
  // its expected 0–16k range rather than 0–1.6M.
  const stepsByDate = new Map<string, number>();
  for (const r of stepRows) {
    if (r.date == null || r.value == null) continue;
    const key = isoDate(r.date);
    stepsByDate.set(key, (stepsByDate.get(key) ?? 0) + r.value / 100);
  }
  for (const [k, v] of stepsByDate) stepsByDate.set(k, Math.round(v));

  const series: HealthDay[] = [];
  let lastWeight = 0;
  for (let i = 0; i < DAYS; i++) {
    const dayUnix = windowStart + i * 86400;
    const date = isoDate(dayUnix);
    const day = emptyDay(i, date);

    const rec = recByDate.get(date);
    if (rec) {
      day.rec = Math.round(rec.recoveryScore);
      day.hrv = Math.round(rec.hrvRmssd);
      day.rhr = Math.round(rec.restingHeartRate);
    }

    const sleep = sleepByDate.get(date);
    if (sleep) {
      const totalAsleepMs =
        sleep.totalLight + sleep.totalSlowWave + sleep.totalRem;
      day.slept = +(totalAsleepMs / 3600000).toFixed(2);
      day.sleepStages = {
        deep: Math.round(sleep.totalSlowWave / 60000),
        rem: Math.round(sleep.totalRem / 60000),
        light: Math.round(sleep.totalLight / 60000),
        awake: Math.round(sleep.totalAwake / 60000),
      };
      day.sleepScore = Math.round(sleep.sleepPerformance);
      day.sleepStart = new Date(sleep.startDate * 1000).toLocaleTimeString(
        'en-GB',
        { hour: '2-digit', minute: '2-digit' },
      );
      day.sleepEnd = new Date(sleep.endDate * 1000).toLocaleTimeString(
        'en-GB',
        { hour: '2-digit', minute: '2-digit' },
      );
    }

    const cycle = cycleByDate.get(date);
    if (cycle) day.strain = +cycle.strain.toFixed(1);

    day.steps = stepsByDate.get(date) ?? 0;

    // Weight: no source yet — keep last known or 0.
    day.weight = lastWeight;
    if (day.weight > 0) lastWeight = day.weight;

    series.push(day);
  }

  // Backfill missing values with prior-day carry where it makes sense
  let prior: HealthDay | null = null;
  for (const d of series) {
    if (prior) {
      if (d.rec === 0) d.rec = prior.rec;
      if (d.hrv === 0) d.hrv = prior.hrv;
      if (d.rhr === 0) d.rhr = prior.rhr;
      if (d.slept === 0) d.slept = prior.slept;
      if (d.strain === 0) d.strain = prior.strain;
    }
    prior = d;
  }

  // If we have no real data at all, fall back to the mock series so the page
  // remains meaningful in dev and during cold-start before the first sync.
  const hasRealData = series.some((d) => d.rec > 0 || d.hrv > 0 || d.steps > 0);
  if (!hasRealData) {
    const mock = buildMockSeries();
    for (let i = 0; i < DAYS; i++) series[i] = mock[i];
  }

  const today = series[DAYS - 1];
  const yesterday = series[DAYS - 2];

  const last7 = series.slice(-7);
  const recAvg7 = Math.round(avg(last7.map((d) => d.rec)));
  const sleepAvgMs = avg(last7.map((d) => d.slept * 3600));

  const todayDeltas = {
    recDelta: today.rec - recAvg7,
    hrvDeltaPct:
      yesterday.hrv > 0
        ? Math.round(((today.hrv - yesterday.hrv) / yesterday.hrv) * 100)
        : 0,
    rhrDelta: Math.round(today.rhr - 58),
    sleepDelta: Math.round(today.slept * 3600 - sleepAvgMs),
  };

  const headline = pickHeadline(today.rec);
  const strap = buildStrap(today, yesterday);
  const narrative = buildNarrative(series);

  let workouts = await getWorkouts(todayStart);
  if (!hasRealData && workouts.length === 0) workouts = buildMockWorkouts();

  // Most recent sync — use latest recovery row's syncedAt, else now.
  const latestSyncedAt =
    recoveryRows.length > 0
      ? (recoveryRows[recoveryRows.length - 1].syncedAt ?? Math.floor(Date.now() / 1000))
      : Math.floor(Date.now() / 1000);
  const syncedAgoSeconds = Math.max(0, Math.floor(Date.now() / 1000) - latestSyncedAt);

  return {
    series,
    today,
    yesterday,
    workouts,
    correlations: STATIC_CORRELATIONS,
    narrative,
    headline,
    strap,
    todayDeltas,
    syncedAgoSeconds,
  };
}
