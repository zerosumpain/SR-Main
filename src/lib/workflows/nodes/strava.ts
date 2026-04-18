import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { getValidToken } from '$lib/health/tokens';
import { getStravaActivities } from '$lib/health/strava';

export { stravaDef } from './strava.def';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

export const stravaExecutor: NodeExecutor = {
  type: 'strava',

  async execute(
    _input: Record<string, unknown>,
    config: Record<string, unknown>,
    _context: ExecutionContext,
  ): Promise<NodeResult> {
    const operation = (config.operation as string) || 'list_activities';
    const token = await getValidToken('strava');
    if (!token) throw new Error('Strava token not available. Connect Strava in Health settings.');

    switch (operation) {
      case 'list_activities': {
        const page = (config.page as number) ?? 1;
        const perPage = (config.perPage as number) ?? 30;
        const activities = await getStravaActivities(token, page, perPage);
        return { output: { activities, count: activities.length } };
      }

      case 'get_activity': {
        const activityId = config.activityId as string;
        if (!activityId) throw new Error('activityId is required for get_activity');
        const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Strava API error: ${res.status}`);
        const activity = await res.json();
        return { output: { activity } };
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
        return { output: { athlete, stats } };
      }

      default:
        throw new Error(`Unknown Strava operation: ${operation}`);
    }
  },

  getInputSchema() {
    return { type: 'object', description: 'Optional overrides for operation parameters' };
  },

  getOutputSchema(config: Record<string, unknown>) {
    const operation = (config.operation as string) || 'list_activities';
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

