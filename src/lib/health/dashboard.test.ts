import { describe, it, expect, vi } from 'vitest';
import { getHealthDashboard } from './dashboard';

// Mock the platform module
vi.mock('$lib/platform', () => ({
  platform: {
    call: vi.fn(),
  },
}));

import { platform } from '$lib/platform';

describe('getHealthDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return chart data for a date range', async () => {
    const mockPlatformCall = vi.mocked(platform.call);

    // Mock responses for each day (2 days)
    // Day 1: 2024-01-01
    mockPlatformCall
      .mockResolvedValueOnce({ sleepScore: 80 })
      .mockResolvedValueOnce({ recoveryScore: 75 })
      .mockResolvedValueOnce({ strainScore: 12 })
      .mockResolvedValueOnce({ events: [{ type: 'workout', duration: 45 }] })
      // Day 2: 2024-01-02
      .mockResolvedValueOnce({ sleepScore: 85 })
      .mockResolvedValueOnce({ recoveryScore: 80 })
      .mockResolvedValueOnce({ strainScore: 10 })
      .mockResolvedValueOnce({ events: [] });

    const result = await getHealthDashboard('2024-01-01', '2024-01-02');

    expect(result.todaySummary).toEqual({
      sleep: 85,
      recovery: 80,
      strain: 10,
    });

    expect(result.chartData.labels).toEqual(['2024-01-01', '2024-01-02']);
    expect(result.chartData.datasets).toHaveLength(4);

    const sleepDataset = result.chartData.datasets.find((d) => d.label === 'Sleep Score');
    expect(sleepDataset?.data).toEqual([80, 85]);

    const workoutDataset = result.chartData.datasets.find((d) => d.label === 'Workout Minutes');
    expect(workoutDataset?.data).toEqual([45, null]);
  });

  it('should handle missing data gracefully', async () => {
    const mockPlatformCall = vi.mocked(platform.call);
    // All calls fail
    mockPlatformCall.mockRejectedValue(new Error('API error'));

    const result = await getHealthDashboard('2024-01-01', '2024-01-01');

    expect(result.todaySummary).toEqual({
      sleep: null,
      recovery: null,
      strain: null,
    });
    expect(result.chartData.labels).toEqual(['2024-01-01']);
    expect(result.chartData.datasets[0].data).toEqual([null]);
  });

  it('should handle empty date range', async () => {
    const mockPlatformCall = vi.mocked(platform.call);
    // Same day start and end
    mockPlatformCall
      .mockResolvedValueOnce({ sleepScore: 90 })
      .mockResolvedValueOnce({ recoveryScore: 90 })
      .mockResolvedValueOnce({ strainScore: 5 })
      .mockResolvedValueOnce({ events: [] });

    const result = await getHealthDashboard('2024-06-15', '2024-06-15');

    expect(result.chartData.labels).toEqual(['2024-06-15']);
    expect(result.chartData.datasets[0].data).toEqual([90]);
  });

  it('should call health tools with correct date', async () => {
    const mockPlatformCall = vi.mocked(platform.call);
    mockPlatformCall.mockResolvedValue({});

    await getHealthDashboard('2024-03-10', '2024-03-11');

    // 2 days * 4 tools = 8 calls
    expect(mockPlatformCall).toHaveBeenCalledTimes(8);

    // Check first and last calls
    expect(mockPlatformCall).toHaveBeenNthCalledWith(1, 'health_sleep', { date: '2024-03-10' });
    expect(mockPlatformCall).toHaveBeenNthCalledWith(8, 'health_timeline', { date: '2024-03-11' });
  });
});
