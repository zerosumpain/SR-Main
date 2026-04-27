import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { getValidToken } from '$lib/health/tokens';
import { getStravaActivities } from '$lib/health/strava';
import { db } from '$lib/db';
import { stravaActivities } from '$lib/db/schema';
import { and, eq, gte, lte, desc } from 'drizzle-orm';

export { stravaDef } from './strava.def';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const DAY = 86_400;

function resolveRange({
  daysOpt,
  startOpt,
  endOpt,
}: {
  daysOpt?: number;
  startOpt?: string;
  endOpt?: string;
}): { startSec: number; endSec: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  const endSec = endOpt ? Math.floor(new Date(endOpt).getTime() / 1000) : nowSec;
  if (startOpt) {
    return { startSec: Math.floor(new Date(startOpt).getTime() / 1000), endSec };
  }
  const days = Math.max(1, daysOpt ?? 30);
  return { startSec: endSec - days * DAY, endSec };
}

export const stravaExecutor: NodeExecutor = {
  type: 'strava',

  async execute(
    _input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'get_summary';
    const days = (config.days as number) ?? 30;
    const sportType = (config.sportType as string | undefined) || undefined;
    const minDistance = (config.minDistanceMeters as number | undefined) ?? 0;
    const start = config.start as string | undefined;
    const end = config.end as string | undefined;

    // ---------- DB-backed ----------

    if (operation === 'get_summary' || operation === 'query_activities') {
      const { startSec, endSec } = resolveRange({ daysOpt: days, startOpt: start, endOpt: end });
      const conditions = [
        gte(stravaActivities.startDate, startSec),
        lte(stravaActivities.startDate, endSec),
      ];
      if (sportType) conditions.push(eq(stravaActivities.sportType, sportType));
      if (operation === 'query_activities' && minDistance > 0) {
        conditions.push(gte(stravaActivities.distance, minDistance));
      }
      const rows = await db
        .select()
        .from(stravaActivities)
        .where(and(...conditions))
        .orderBy(desc(stravaActivities.startDate));

      if (operation === 'get_summary') {
        const totalDistanceMeters = rows.reduce((a, r) => a + (r.distance ?? 0), 0);
        const totalMovingTimeSec = rows.reduce((a, r) => a + (r.movingTime ?? 0), 0);
        const totalElevationMeters = rows.reduce((a, r) => a + (r.totalElevationGain ?? 0), 0);
        const sportCounts = rows.reduce<Record<string, number>>((acc, r) => {
          const key = r.sportType ?? r.type ?? 'Unknown';
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        return {
          output: {
            summary: {
              rangeStart: new Date(startSec * 1000).toISOString(),
              rangeEnd: new Date(endSec * 1000).toISOString(),
              days: Math.round((endSec - startSec) / DAY),
              filter: { sportType: sportType ?? null },
              count: rows.length,
              totalDistanceKm: Number((totalDistanceMeters / 1000).toFixed(1)),
              totalMovingHours: Number((totalMovingTimeSec / 3600).toFixed(2)),
              totalElevationMeters,
              avgPaceMinPerKm:
                totalDistanceMeters > 0
                  ? Number((totalMovingTimeSec / 60 / (totalDistanceMeters / 1000)).toFixed(2))
                  : 0,
              bySport: Object.entries(sportCounts).map(([sport, count]) => ({ sport, count })),
            },
          },
        };
      }

      // query_activities — return slim records (LLM-friendly, no map polylines)
      return {
        output: {
          activities: rows.map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            sportType: r.sportType,
            startDateLocal: r.startDateLocal,
            distanceKm: Number(((r.distance ?? 0) / 1000).toFixed(2)),
            movingMinutes: Math.round((r.movingTime ?? 0) / 60),
            elevationMeters: r.totalElevationGain,
            avgHeartrate: r.averageHeartrate,
            maxHeartrate: r.maxHeartrate,
            calories: r.calories,
            sufferScore: r.sufferScore,
          })),
          count: rows.length,
        },
      };
    }

    // ---------- API-backed ----------

    const token = await getValidToken('strava');
    if (!token) throw new Error('Strava token not available. Connect Strava in Health settings.');

    switch (operation) {
      case 'list_activities': {
        const page = (config.page as number) ?? 1;
        const perPage = (config.perPage as number) ?? 30;
        const after = start ? Math.floor(new Date(start).getTime() / 1000) : undefined;
        const before = end ? Math.floor(new Date(end).getTime() / 1000) : undefined;
        const activities =
          after || before
            ? await getStravaActivities(token, page, perPage, { after, before })
            : await getStravaActivities(token, page, perPage);
        return { output: { activities, count: activities.length }, rowCount: activities.length };
      }

      case 'get_activity': {
        const activityId = config.activityId as string;
        if (!activityId) throw new Error('activityId is required for get_activity');
        const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Strava API error: ${res.status}`);
        const activity = await res.json();
        return { output: { activity }, rowCount: 1 };
      }

      case 'get_athlete_stats': {
        const athleteRes = await fetch(`${STRAVA_API_BASE}/athlete`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!athleteRes.ok) throw new Error(`Strava API error: ${athleteRes.status}`);
        const athlete = await athleteRes.json();
        const statsRes = await fetch(`${STRAVA_API_BASE}/athletes/${athlete.id}/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!statsRes.ok) throw new Error(`Strava API error: ${statsRes.status}`);
        const stats = await statsRes.json();
        return { output: { athlete, stats }, rowCount: 1 };
      }

      default:
        throw new Error(`Unknown Strava operation: ${operation}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Optional overrides for operation parameters' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const operation = (config.operation as string) || 'get_summary';
    if (operation === 'get_summary') {
      return { type: 'object', properties: { summary: { type: 'object' } } };
    }
    if (operation === 'query_activities') {
      return {
        type: 'object',
        properties: {
          activities: { type: 'array', description: 'Slim activity records suitable for tool use' },
          count: { type: 'number' },
        },
      };
    }
    if (operation === 'list_activities') {
      return {
        type: 'object',
        properties: {
          activities: { type: 'array', description: 'Array of Strava activity objects' },
          count: { type: 'number', description: 'Number of activities returned' },
        },
      };
    }
    if (operation === 'get_activity') {
      return {
        type: 'object',
        properties: { activity: { type: 'object', description: 'Full activity detail' } },
      };
    }
    return {
      type: 'object',
      properties: {
        athlete: { type: 'object', description: 'Athlete profile' },
        stats: { type: 'object', description: 'Athlete statistics' },
      },
    };
  },
};
