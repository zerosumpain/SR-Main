import { describe, it, expect } from 'vitest';
import type {
  SyncOptions,
  SyncResult,
  SyncResponse,
  ReadinessResponse,
  TrainingLoadResponse,
  SparklineData,
  TimelineEvent,
  SleepAnalysis,
  BodySignal,
  StatsResponse,
} from '$lib/health/types';

describe('health types', () => {
  it('SyncOptions accepts optional fields', () => {
    const opts: SyncOptions = {};
    expect(opts).toBeDefined();

    const full: SyncOptions = {
      fullBackfill: true,
      maxPages: 10,
      startDate: new Date('2025-01-01'),
    };
    expect(full.fullBackfill).toBe(true);
    expect(full.maxPages).toBe(10);
    expect(full.startDate).toBeInstanceOf(Date);
  });

  it('SyncResult has required fields', () => {
    const result: SyncResult = {
      success: true,
      recordsSynced: 42,
      errors: [],
      duration: 1500,
    };
    expect(result.success).toBe(true);
    expect(result.recordsSynced).toBe(42);
    expect(result.errors).toHaveLength(0);
    expect(result.duration).toBe(1500);
  });

  it('SyncResponse has optional service results and required timestamp', () => {
    const response: SyncResponse = {
      timestamp: '2026-03-20T00:00:00Z',
    };
    expect(response.timestamp).toBeDefined();
    expect(response.strava).toBeUndefined();
    expect(response.whoop).toBeUndefined();
    expect(response.apple).toBeUndefined();

    const full: SyncResponse = {
      strava: { success: true, recordsSynced: 5, errors: [], duration: 200 },
      whoop: { success: false, recordsSynced: 0, errors: ['auth failed'], duration: 50 },
      apple: { success: true, recordsSynced: 100, errors: [], duration: 300 },
      timestamp: '2026-03-20T00:00:00Z',
    };
    expect(full.strava?.recordsSynced).toBe(5);
    expect(full.whoop?.errors).toContain('auth failed');
    expect(full.apple?.recordsSynced).toBe(100);
  });

  it('ReadinessResponse has expected shape', () => {
    const readiness: ReadinessResponse = {
      score: 78,
      label: 'Good',
      factors: {
        recovery: { value: 80, weight: 0.4 },
        hrvTrend: { value: 65, weight: 0.3, direction: 'up' },
        sleepQuality: { value: 75, weight: 0.2 },
        loadBalance: { value: 70, weight: 0.1, zone: 'optimal' },
      },
      recommendation: 'Good day for a hard session.',
    };
    expect(readiness.score).toBe(78);
    expect(readiness.factors.hrvTrend.direction).toBe('up');
    expect(readiness.factors.loadBalance.zone).toBe('optimal');
  });

  it('TrainingLoadResponse zone is a valid enum value', () => {
    const zones: TrainingLoadResponse['zone'][] = [
      'detraining',
      'undertraining',
      'optimal',
      'caution',
      'danger',
    ];
    const load: TrainingLoadResponse = {
      acute: 350,
      chronic: 400,
      ratio: 0.875,
      zone: 'optimal',
      history: [{ date: '2026-03-19', load: 380 }],
    };
    expect(zones).toContain(load.zone);
    expect(load.history[0].date).toBe('2026-03-19');
  });

  it('SparklineData trend is a valid direction', () => {
    const sparkline: SparklineData = {
      metric: 'hrv',
      values: [
        { date: '2026-03-18', value: 55 },
        { date: '2026-03-19', value: 58 },
        { date: '2026-03-20', value: 60 },
      ],
      current: 60,
      trend: 'up',
    };
    expect(sparkline.values).toHaveLength(3);
    expect(sparkline.trend).toBe('up');
  });

  it('TimelineEvent type is a valid event type', () => {
    const validTypes: TimelineEvent['type'][] = [
      'strava_activity',
      'whoop_workout',
      'whoop_sleep',
      'whoop_recovery',
    ];
    const event: TimelineEvent = {
      id: 'abc-123',
      type: 'strava_activity',
      date: '2026-03-20T08:00:00Z',
      title: 'Morning Run',
      summary: { distance: 10000, duration: 3600 },
    };
    expect(validTypes).toContain(event.type);
    expect(event.summary['distance']).toBe(10000);
  });

  it('SleepAnalysis has latest and trend fields', () => {
    const sleep: SleepAnalysis = {
      latest: {
        date: '2026-03-20',
        endedAt: '2026-03-20T07:00:00.000Z',
        totalDuration: 28800000,
        lightPercent: 50,
        deepPercent: 20,
        remPercent: 25,
        awakePercent: 5,
        performance: 85,
        consistency: 72,
        efficiency: 90,
      },
      trend: [
        { date: '2026-03-19', duration: 27000000, performance: 80 },
        { date: '2026-03-20', duration: 28800000, performance: 85 },
      ],
    };
    expect(sleep.latest?.deepPercent).toBe(20);
    expect(sleep.trend).toHaveLength(2);
  });

  it('BodySignal has required fields', () => {
    const signal: BodySignal = {
      metric: 'resting_hr',
      current: 52,
      average7d: 54,
      trend: 'down',
      unit: 'bpm',
    };
    expect(signal.trend).toBe('down');
    expect(signal.unit).toBe('bpm');
  });

  it('StatsResponse has weekly and personalRecords', () => {
    const stats: StatsResponse = {
      weekly: {
        activities: 5,
        totalDistance: 50000,
        totalDuration: 18000,
        totalElevation: 800,
        avgRecovery: 72,
        avgSleep: 7.5,
      },
      personalRecords: [
        { label: 'Longest Run', value: 42195, unit: 'm', date: '2025-10-01' },
      ],
    };
    expect(stats.weekly.activities).toBe(5);
    expect(stats.personalRecords[0].label).toBe('Longest Run');
  });
});
