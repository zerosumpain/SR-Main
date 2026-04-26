import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { getValidToken } from '$lib/health/tokens';
import {
  getWhoopCycles,
  getWhoopRecoveries,
  getWhoopSleeps,
  getWhoopWorkouts,
} from '$lib/health/whoop';
import { db } from '$lib/db';
import { whoopRecovery, whoopSleep, whoopCycles, whoopWorkouts } from '$lib/db/schema';
import { and, gte, lte, desc } from 'drizzle-orm';

export { whoopDef } from './whoop.def';

const DAY = 86_400;

interface RangeOpts {
  daysOpt?: number;
  startOpt?: string;
  endOpt?: string;
}

function resolveRange({ daysOpt, startOpt, endOpt }: RangeOpts): { startSec: number; endSec: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const endSec = endOpt ? Math.floor(new Date(endOpt).getTime() / 1000) : nowSec;
  if (startOpt) {
    return { startSec: Math.floor(new Date(startOpt).getTime() / 1000), endSec };
  }
  const days = Math.max(1, daysOpt ?? 30);
  return { startSec: endSec - days * DAY, endSec };
}

function avg(xs: number[]): number {
  const valid = xs.filter((x) => Number.isFinite(x) && x > 0);
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

const RECOVERY_METRIC_COL = {
  hrv: whoopRecovery.hrvRmssd,
  recovery: whoopRecovery.recoveryScore,
  rhr: whoopRecovery.restingHeartRate,
} as const;

export const whoopExecutor: NodeExecutor = {
  type: 'whoop',

  async execute(
    _input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'get_summary';
    const limit = (config.limit as number) ?? 10;
    const start = config.start as string | undefined;
    const end = config.end as string | undefined;
    const days = (config.days as number) ?? 30;

    // ---------- DB-backed (fast, free) ----------

    if (operation === 'get_summary') {
      const { startSec, endSec } = resolveRange({ daysOpt: days, startOpt: start, endOpt: end });

      const [recoveryRows, sleepRows, workoutRows, cycleRows] = await Promise.all([
        db.select().from(whoopRecovery).where(
          and(gte(whoopRecovery.createdDate, startSec), lte(whoopRecovery.createdDate, endSec)),
        ),
        db.select().from(whoopSleep).where(
          and(gte(whoopSleep.startDate, startSec), lte(whoopSleep.startDate, endSec)),
        ),
        db.select().from(whoopWorkouts).where(
          and(gte(whoopWorkouts.startDate, startSec), lte(whoopWorkouts.startDate, endSec)),
        ),
        db.select().from(whoopCycles).where(
          and(gte(whoopCycles.startDate, startSec), lte(whoopCycles.startDate, endSec)),
        ),
      ]);

      const totalSleepMs = sleepRows.reduce(
        (a, s) =>
          a +
          (s.totalLight ?? 0) +
          (s.totalSlowWave ?? 0) +
          (s.totalRem ?? 0),
        0,
      );

      const summary = {
        rangeStart: new Date(startSec * 1000).toISOString(),
        rangeEnd: new Date(endSec * 1000).toISOString(),
        days: Math.round((endSec - startSec) / DAY),
        recovery: {
          samples: recoveryRows.length,
          avgScore: Math.round(avg(recoveryRows.map((r) => r.recoveryScore))),
          avgHrvMs: Math.round(avg(recoveryRows.map((r) => r.hrvRmssd))),
          avgRestingHr: Math.round(avg(recoveryRows.map((r) => r.restingHeartRate))),
        },
        sleep: {
          samples: sleepRows.length,
          avgPerformance: Math.round(avg(sleepRows.map((s) => s.sleepPerformance))),
          avgEfficiency: Math.round(avg(sleepRows.map((s) => s.sleepEfficiency))),
          avgConsistency: Math.round(avg(sleepRows.map((s) => s.sleepConsistency))),
          avgDurationHours:
            sleepRows.length > 0
              ? Number((totalSleepMs / sleepRows.length / 1000 / 3600).toFixed(2))
              : 0,
        },
        workouts: {
          count: workoutRows.length,
          totalStrain: Number(workoutRows.reduce((a, w) => a + (w.strain ?? 0), 0).toFixed(2)),
          totalKilojoule: Math.round(workoutRows.reduce((a, w) => a + (w.kilojoule ?? 0), 0)),
          bySport: Object.entries(
            workoutRows.reduce<Record<string, number>>((acc, w) => {
              const k = w.sportName ?? 'Unknown';
              acc[k] = (acc[k] ?? 0) + 1;
              return acc;
            }, {}),
          ).map(([sport, count]) => ({ sport, count })),
        },
        cycles: {
          samples: cycleRows.length,
          avgDailyStrain: Number(avg(cycleRows.map((c) => c.strain)).toFixed(2)),
        },
      };

      return { output: { summary } };
    }

    if (operation === 'get_recent') {
      const { startSec, endSec } = resolveRange({ daysOpt: days, startOpt: start, endOpt: end });
      const rows = await db
        .select()
        .from(whoopRecovery)
        .where(
          and(gte(whoopRecovery.createdDate, startSec), lte(whoopRecovery.createdDate, endSec)),
        )
        .orderBy(desc(whoopRecovery.createdDate));

      const series = rows.map((r) => ({
        date: new Date(r.createdDate * 1000).toISOString().slice(0, 10),
        recovery: r.recoveryScore,
        hrvMs: r.hrvRmssd,
        restingHr: r.restingHeartRate,
        spo2: r.spo2,
        skinTempC: r.skinTemp != null ? r.skinTemp / 100 : null,
      }));
      return { output: { series, count: series.length } };
    }

    if (operation === 'query_recovery') {
      const metric = (config.metric as keyof typeof RECOVERY_METRIC_COL | 'sleep_performance' | 'strain') ?? 'recovery';
      const { startSec, endSec } = resolveRange({ daysOpt: days, startOpt: start, endOpt: end });

      if (metric === 'sleep_performance') {
        const rows = await db
          .select({ d: whoopSleep.startDate, v: whoopSleep.sleepPerformance })
          .from(whoopSleep)
          .where(and(gte(whoopSleep.startDate, startSec), lte(whoopSleep.startDate, endSec)))
          .orderBy(whoopSleep.startDate);
        return {
          output: {
            metric,
            series: rows.map((r) => ({ date: new Date(r.d * 1000).toISOString().slice(0, 10), value: r.v })),
          },
        };
      }
      if (metric === 'strain') {
        const rows = await db
          .select({ d: whoopCycles.startDate, v: whoopCycles.strain })
          .from(whoopCycles)
          .where(and(gte(whoopCycles.startDate, startSec), lte(whoopCycles.startDate, endSec)))
          .orderBy(whoopCycles.startDate);
        return {
          output: {
            metric,
            series: rows.map((r) => ({ date: new Date(r.d * 1000).toISOString().slice(0, 10), value: Number(r.v.toFixed(2)) })),
          },
        };
      }
      const col = RECOVERY_METRIC_COL[metric as keyof typeof RECOVERY_METRIC_COL];
      if (!col) throw new Error(`Unknown Whoop metric: ${metric}`);
      const rows = await db
        .select({ d: whoopRecovery.createdDate, v: col })
        .from(whoopRecovery)
        .where(and(gte(whoopRecovery.createdDate, startSec), lte(whoopRecovery.createdDate, endSec)))
        .orderBy(whoopRecovery.createdDate);
      return {
        output: {
          metric,
          series: rows.map((r) => ({ date: new Date(r.d * 1000).toISOString().slice(0, 10), value: r.v })),
        },
      };
    }

    // ---------- API-backed (live, costs a Whoop API hit) ----------

    const token = await getValidToken('whoop');
    if (!token) throw new Error('Whoop token not available. Connect Whoop in Health settings.');

    const opts = { limit, ...(start ? { start } : {}), ...(end ? { end } : {}) };

    switch (operation) {
      case 'get_cycles': {
        const cycles = await getWhoopCycles(token, opts);
        return { output: { cycles, count: cycles.length } };
      }
      case 'get_recovery': {
        const recoveries = await getWhoopRecoveries(token, opts);
        return { output: { recoveries, count: recoveries.length } };
      }
      case 'get_sleep': {
        const sleeps = await getWhoopSleeps(token, opts);
        return { output: { sleeps, count: sleeps.length } };
      }
      case 'get_workouts': {
        const workouts = await getWhoopWorkouts(token, opts);
        return { output: { workouts, count: workouts.length } };
      }
      default:
        throw new Error(`Unknown Whoop operation: ${operation}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Optional overrides (limit, start, end, days, metric)' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const op = (config.operation as string) || 'get_summary';
    if (op === 'get_summary') {
      return { type: 'object', properties: { summary: { type: 'object' } } };
    }
    if (op === 'get_recent') {
      return {
        type: 'object',
        properties: {
          series: { type: 'array', description: 'Per-day records: date, recovery, hrvMs, restingHr' },
          count: { type: 'number' },
        },
      };
    }
    if (op === 'query_recovery') {
      return {
        type: 'object',
        properties: {
          metric: { type: 'string' },
          series: { type: 'array', description: 'Daily { date, value }' },
        },
      };
    }
    const arrayKey =
      ({ get_cycles: 'cycles', get_recovery: 'recoveries', get_sleep: 'sleeps', get_workouts: 'workouts' } as Record<string, string>)[op] ?? 'records';
    return {
      type: 'object',
      properties: {
        [arrayKey]: { type: 'array', description: `Array of Whoop ${op.replace('get_', '')} records` },
        count: { type: 'number' },
      },
    };
  },
};
