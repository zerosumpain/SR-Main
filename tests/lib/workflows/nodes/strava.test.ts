import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/health/tokens', () => ({
  getValidToken: vi.fn().mockResolvedValue('mock-strava-token'),
}));

vi.mock('$lib/health/strava', () => ({
  getStravaActivities: vi.fn().mockResolvedValue([
    { id: 1, name: 'Morning Run', type: 'Run', distance: 5000, moving_time: 1800, start_date: '2026-04-12T07:00:00Z' },
  ]),
}));

import { stravaExecutor, stravaDef } from '$lib/workflows/nodes/strava';
import type { ExecutionContext } from '$lib/workflows/types';

const mockContext: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
};

describe('stravaExecutor', () => {
  describe('list_activities', () => {
    it('returns activities array', async () => {
      const result = await stravaExecutor.execute({}, { operation: 'list_activities' }, mockContext);
      expect(result.output.activities).toHaveLength(1);
      expect(result.output.activities[0].name).toBe('Morning Run');
    });

    it('returns count', async () => {
      const result = await stravaExecutor.execute({}, { operation: 'list_activities' }, mockContext);
      expect(result.output.count).toBe(1);
    });

    it('passes page and perPage config', async () => {
      const { getStravaActivities } = await import('$lib/health/strava');
      await stravaExecutor.execute({}, { operation: 'list_activities', page: 2, perPage: 10 }, mockContext);
      expect(getStravaActivities).toHaveBeenCalledWith('mock-strava-token', 2, 10);
    });

    it('uses default page 1 and perPage 30 when not specified', async () => {
      const { getStravaActivities } = await import('$lib/health/strava');
      vi.mocked(getStravaActivities).mockClear();
      await stravaExecutor.execute({}, { operation: 'list_activities' }, mockContext);
      expect(getStravaActivities).toHaveBeenCalledWith('mock-strava-token', 1, 30);
    });
  });

  describe('get_activity', () => {
    it('fetches a single activity by id', async () => {
      const mockActivity = { id: 42, name: 'Evening Ride', type: 'Ride' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockActivity,
      }));
      const result = await stravaExecutor.execute({}, { operation: 'get_activity', activityId: '42' }, mockContext);
      expect(result.output.activity).toEqual(mockActivity);
      vi.unstubAllGlobals();
    });

    it('throws when activityId is not provided', async () => {
      await expect(
        stravaExecutor.execute({}, { operation: 'get_activity' }, mockContext)
      ).rejects.toThrow('activityId is required');
    });

    it('throws on Strava API error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
      await expect(
        stravaExecutor.execute({}, { operation: 'get_activity', activityId: '999' }, mockContext)
      ).rejects.toThrow('Strava API error: 404');
      vi.unstubAllGlobals();
    });
  });

  describe('get_athlete_stats', () => {
    it('fetches athlete and stats', async () => {
      const mockAthlete = { id: 123, firstname: 'John' };
      const mockStats = { recent_run_totals: { count: 5 } };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => mockAthlete })
        .mockResolvedValueOnce({ ok: true, json: async () => mockStats })
      );
      const result = await stravaExecutor.execute({}, { operation: 'get_athlete_stats' }, mockContext);
      expect(result.output.athlete).toEqual(mockAthlete);
      expect(result.output.stats).toEqual(mockStats);
      vi.unstubAllGlobals();
    });

    it('throws when athlete fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
      await expect(
        stravaExecutor.execute({}, { operation: 'get_athlete_stats' }, mockContext)
      ).rejects.toThrow('Strava API error: 401');
      vi.unstubAllGlobals();
    });
  });

  describe('no token', () => {
    beforeEach(async () => {
      const { getValidToken } = await import('$lib/health/tokens');
      vi.mocked(getValidToken).mockResolvedValueOnce(null);
    });

    it('throws when token not available', async () => {
      await expect(
        stravaExecutor.execute({}, { operation: 'list_activities' }, mockContext)
      ).rejects.toThrow('Strava token not available');
    });
  });

  describe('unknown operation', () => {
    it('throws on unknown operation', async () => {
      await expect(
        stravaExecutor.execute({}, { operation: 'do_something_weird' }, mockContext)
      ).rejects.toThrow('Unknown Strava operation: do_something_weird');
    });
  });
});

describe('stravaDef', () => {
  it('has type strava', () => {
    expect(stravaDef.type).toBe('strava');
  });

  it('is in integration category', () => {
    expect(stravaDef.category).toBe('integration');
  });

  it('requires operation in configSchema', () => {
    expect(stravaDef.configSchema.required).toContain('operation');
  });

  it('has default config', () => {
    expect(stravaDef.defaultConfig?.operation).toBe('list_activities');
  });
});
