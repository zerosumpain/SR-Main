import { db } from '$lib/db';
import {
  whoopRecovery,
  whoopSleep,
  whoopCycles,
  whoopWorkouts,
  appleHealthMetrics,
} from '$lib/db/schema';
import { gte, eq, and, desc, inArray } from 'drizzle-orm';
import { getCorrelations } from './correlations-service';
import { getNarrative } from './narrative-service';
import { getHeroCopy } from './hero-copy-service';

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

export type ActivityRings = {
  moveKcal: number;
  moveTarget: number;
  exerciseMin: number;
  exerciseTarget: number;
  standHours: number;
  standTarget: number;
};

export type Workout = { day: string; name: string; strain: number; dur: string };

export type Correlation = {
  cause: string;
  effect: string;
  num: string;
  conf: string;
  confidence: 'STRONG' | 'MAYBE' | 'NOISE';
};

export type Annotation = { when: string; text: string };

export type HealthSeriesData = {
  series: HealthDay[];
  today: HealthDay;
  yesterday: HealthDay;
  workouts: Workout[];
  correlations: Correlation[];
  annotations: Annotation[];
  narrative: { tag: string; text: string };
  headline: { primary: string; ghost: string };
  strap: string;
  rhrBaseline: number;
  rings: ActivityRings;
  todayDeltas: {
    recDelta: number;
    hrvDeltaPct: number;
    rhrDelta: number;
    sleepDelta: number;
  };
  syncedAgoSeconds: number;
};

const DAYS = 30;

// Whoop strain is a 0–21 score. Some historical rows landed in the DB at
// strain × 100 (legacy sync path). Detect either form and return the real
// 0–21 value rounded to 1dp.
function normaliseStrain(raw: number): number {
  const v = raw > 22 ? raw / 100 : raw;
  return +v.toFixed(1);
}

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

export function pickHeadline(rec: number): { primary: string; ghost: string } {
  if (rec < 40) return { primary: "WRECKED.", ghost: "DON'T LIFT." };
  if (rec < 55) return { primary: "MEH.", ghost: "WALK IT OFF." };
  if (rec < 70) return { primary: "HOLD STEADY.", ghost: "STEADY HANDS." };
  if (rec < 85) return { primary: "READY.", ghost: "GO MOVE." };
  return { primary: "RECOVERED.", ghost: "BUILD SOMETHING." };
}

export function buildStrap(
  today: { rec: number; hrv: number; rhr: number; slept: number },
  yesterday: { hrv: number },
  rhrBaseline: number,
): string {
  if (yesterday.hrv === 0 || today.hrv === 0) {
    return `Recovery's at ${today.rec}%. HRV ${today.hrv}ms, RHR ${today.rhr}bpm. Body's reporting in.`;
  }
  const hrvDelta = Math.round(((yesterday.hrv - today.hrv) / yesterday.hrv) * 100);
  const direction = hrvDelta > 0 ? 'dropped' : 'climbed';
  const baselineDelta = today.rhr - rhrBaseline;
  const rhrLine =
    baselineDelta > 0
      ? `Heart rate's still ${baselineDelta} bpm above baseline.`
      : baselineDelta < 0
        ? `Heart rate's ${Math.abs(baselineDelta)} bpm below baseline.`
        : `Heart rate's at baseline.`;
  return `Recovery's at ${today.rec}%. HRV ${direction} ${Math.abs(hrvDelta)}% overnight after yesterday's session. ${rhrLine} The body is asking, politely, for a walk and a sandwich.`;
}

function median(values: number[]): number {
  const xs = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? Math.round((xs[mid - 1] + xs[mid]) / 2) : xs[mid];
}

function fmtAnnotDate(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const dom = d.getUTCDate();
  const mon = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toUpperCase();
  const dow = d.toLocaleString('en', { weekday: 'short', timeZone: 'UTC' }).toUpperCase();
  return `${mon} ${dom} · ${dow}`;
}

function computeAnnotations(series: HealthDay[]): Annotation[] {
  const out: Annotation[] = [];
  if (!series.length) return out;

  // 1) Peak strain day in window (skip "today" so it's not redundant with the hero)
  const windowForPeaks = series.slice(0, -1);
  if (windowForPeaks.length) {
    const peakStrain = [...windowForPeaks].sort((a, b) => b.strain - a.strain)[0];
    if (peakStrain.strain > 8) {
      out.push({
        when: fmtAnnotDate(peakStrain.date),
        text: `Hardest session in the window. Strain hit <em>${peakStrain.strain.toFixed(1)}</em> — visible spike on the strain row.`,
      });
    }
  }

  // 2) Lowest HRV day
  const validHrv = series.filter((d) => d.hrv > 0);
  if (validHrv.length) {
    const lowHrv = [...validHrv].sort((a, b) => a.hrv - b.hrv)[0];
    const sameDay = series.find((d) => d.date === lowHrv.date);
    const rhrNote =
      sameDay && sameDay.rhr > 0
        ? ` RHR was <em>${sameDay.rhr} bpm</em> — same physiological story, two metrics.`
        : '';
    out.push({
      when: fmtAnnotDate(lowHrv.date),
      text: `HRV trough at <em>${lowHrv.hrv}ms</em>, the darkest cell in the row.${rhrNote}`,
    });
  }

  // 3) Longest green-recovery streak (rec >= 67)
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i].rec >= 67) {
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curLen = 0;
    }
  }
  if (bestLen >= 2) {
    const a = series[bestStart];
    const b = series[bestStart + bestLen - 1];
    const range = bestLen === 1 ? fmtAnnotDate(a.date) : `${fmtAnnotDate(a.date)} → ${fmtAnnotDate(b.date)}`;
    out.push({
      when: range,
      text: `${bestLen} green recovery days back-to-back. The body, briefly, was happy.`,
    });
  }

  return out.slice(0, 3);
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
  {
    cause: 'When I sleep <6h',
    effect: 'HRV drops',
    num: '−21%',
    conf: 'r = −0.74 · n=12',
    confidence: 'MAYBE',
  },
  {
    cause: 'When I drink',
    effect: 'Recovery is',
    num: '−18 pts',
    conf: 'r = −0.68 · n=8',
    confidence: 'MAYBE',
  },
  {
    cause: 'Strain >16 days',
    effect: 'Need',
    num: '2 days',
    conf: 'observed 4/4',
    confidence: 'MAYBE',
  },
  {
    cause: 'After a 12k+ step day',
    effect: 'Sleep score',
    num: '+11 pts',
    conf: 'r = +0.52 · n=14',
    confidence: 'MAYBE',
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

  const [recoveryRows, sleepRows, cycleRows, stepRows, weightRows, ringRows] = await Promise.all([
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
    db
      .select({ date: appleHealthMetrics.date, value: appleHealthMetrics.value })
      .from(appleHealthMetrics)
      .where(
        and(
          gte(appleHealthMetrics.date, windowStart),
          eq(appleHealthMetrics.metricName, 'body_mass'),
        ),
      )
      .orderBy(appleHealthMetrics.date),
    db
      .select({
        date: appleHealthMetrics.date,
        metric: appleHealthMetrics.metricName,
        value: appleHealthMetrics.value,
      })
      .from(appleHealthMetrics)
      .where(
        and(
          gte(appleHealthMetrics.date, todayStart),
          inArray(appleHealthMetrics.metricName, [
            'active_energy',
            'apple_exercise_time',
            'apple_stand_hour',
          ]),
        ),
      ),
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

  // step_count rows are per-bucket deltas from Health Auto Export (qty =
  // steps in that bucket), stored ×100 by the ingest. Sum and divide.
  const stepsByDate = new Map<string, number>();
  for (const r of stepRows) {
    if (r.date == null || r.value == null) continue;
    const key = isoDate(r.date);
    stepsByDate.set(key, (stepsByDate.get(key) ?? 0) + r.value);
  }
  for (const [k, v] of stepsByDate) stepsByDate.set(k, Math.round(v / 100));

  // Weight: latest reading per day (kg). Same *100 storage convention.
  const weightByDate = new Map<string, number>();
  for (const r of weightRows) {
    if (r.date == null || r.value == null) continue;
    weightByDate.set(isoDate(r.date), r.value / 100);
  }

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
    if (cycle) day.strain = normaliseStrain(cycle.strain);

    day.steps = stepsByDate.get(date) ?? 0;

    const w = weightByDate.get(date);
    if (w && w > 0) {
      day.weight = +w.toFixed(1);
      lastWeight = day.weight;
    } else {
      day.weight = lastWeight;
    }

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

  const rhrMedian = median(series.map((d) => d.rhr));
  const rhrBaseline = rhrMedian > 0 ? rhrMedian : 58;

  const todayDeltas = {
    recDelta: today.rec - recAvg7,
    hrvDeltaPct:
      yesterday.hrv > 0
        ? Math.round(((today.hrv - yesterday.hrv) / yesterday.hrv) * 100)
        : 0,
    rhrDelta: Math.round(today.rhr - rhrBaseline),
    sleepDelta: Math.round(today.slept * 3600 - sleepAvgMs),
  };

  const heroCopy = await getHeroCopy(
    {
      date: today.date,
      rec: today.rec,
      hrv: today.hrv,
      rhr: today.rhr,
      slept: today.slept,
      rhrBaseline,
      hrvDeltaPct: todayDeltas.hrvDeltaPct,
    },
    { pickHeadline, buildStrap },
  );
  const { headline, strap } = heroCopy;
  const narrative = await getNarrative(series, rhrBaseline);
  const annotations = computeAnnotations(series);

  let workouts = await getWorkouts(todayStart);
  if (!hasRealData && workouts.length === 0) workouts = buildMockWorkouts();

  let correlations = await getCorrelations();
  if (correlations.length === 0) correlations = STATIC_CORRELATIONS;

  // Activity rings (today only). Apple Activity metrics (active_energy /
  // apple_exercise_time / apple_stand_hour) aren't being ingested yet, so
  // derive the same shape from data we already have:
  //   - Move kcal: Apple active_energy if present, else Whoop daily
  //     kilojoule * 0.239006 (kJ → kcal).
  //   - Exercise minutes: Apple apple_exercise_time if present, else sum
  //     of zone-2-and-up durations across today's Whoop workouts (Apple
  //     defines exercise as MET ≥ 3, ≈ Whoop zone 2+).
  //   - Stand hours: Apple apple_stand_hour if present, else count of
  //     distinct hours today with at least one Apple heart_rate reading
  //     (proxy for "watch worn and moving").
  let moveKcal = 0;
  let exerciseMin = 0;
  let standHours = 0;
  let appleMoveSeen = false;
  let appleExerciseSeen = false;
  let appleStandSeen = false;
  for (const r of ringRows) {
    if (r.value == null) continue;
    const v = r.value / 100;
    if (r.metric === 'active_energy') {
      moveKcal += v;
      appleMoveSeen = true;
    } else if (r.metric === 'apple_exercise_time') {
      exerciseMin += v;
      appleExerciseSeen = true;
    } else if (r.metric === 'apple_stand_hour') {
      standHours += v > 0 ? 1 : 0;
      appleStandSeen = true;
    }
  }

  if (!appleMoveSeen) {
    // Sum today's Whoop kilojoule. whoopCycles row keyed by ISO date
    // already loaded above.
    const todayCycle = cycleByDate.get(isoDate(todayStart));
    if (todayCycle) moveKcal = todayCycle.kilojoule * 0.239006;
  }

  if (!appleExerciseSeen) {
    const todayWorkouts = await db
      .select({
        zoneTwo: whoopWorkouts.zoneTwo,
        zoneThree: whoopWorkouts.zoneThree,
        zoneFour: whoopWorkouts.zoneFour,
        zoneFive: whoopWorkouts.zoneFive,
      })
      .from(whoopWorkouts)
      .where(gte(whoopWorkouts.startDate, todayStart));
    const ms = todayWorkouts.reduce(
      (s, w) => s + (w.zoneTwo ?? 0) + (w.zoneThree ?? 0) + (w.zoneFour ?? 0) + (w.zoneFive ?? 0),
      0,
    );
    exerciseMin = ms / 60000;
  }

  if (!appleStandSeen) {
    const hourRows = await db
      .select({ date: appleHealthMetrics.date })
      .from(appleHealthMetrics)
      .where(
        and(
          gte(appleHealthMetrics.date, todayStart),
          eq(appleHealthMetrics.metricName, 'heart_rate'),
        ),
      );
    const distinctHours = new Set<number>();
    for (const r of hourRows) {
      if (r.date != null) distinctHours.add(Math.floor(r.date / 3600));
    }
    standHours = distinctHours.size;
  }

  const rings: ActivityRings = {
    moveKcal: Math.round(moveKcal),
    moveTarget: 600,
    exerciseMin: Math.round(exerciseMin),
    exerciseTarget: 30,
    standHours: Math.min(12, Math.round(standHours)),
    standTarget: 12,
  };
  if (!hasRealData && rings.moveKcal === 0 && rings.exerciseMin === 0 && rings.standHours === 0) {
    rings.moveKcal = 192;
    rings.exerciseMin = 5;
    rings.standHours = 8;
  }

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
    correlations,
    annotations,
    rings,
    narrative,
    headline,
    strap,
    rhrBaseline,
    todayDeltas,
    syncedAgoSeconds,
  };
}
