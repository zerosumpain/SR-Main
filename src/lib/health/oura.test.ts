import { describe, it, expect, vi } from 'vitest';
import { fetchOuraData, health_fetch_oura } from './oura';
import type { PlatformCall } from './oura';

describe('fetchOuraData', () => {
  const mockPlatformCall: PlatformCall = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch sleep data for a given date', async () => {
    const mockSleepData = {
      data: [
        {
          id: 'abc123',
          day: '2025-03-15',
          score: 85,
          contributors: {
            deep_sleep: 90,
            efficiency: 80,
            latency: 70,
            rem_sleep: 85,
            restfulness: 75,
            timing: 95,
            total_sleep: 88,
          },
          duration: 28800,
          total_sleep_duration: 27000,
          awake_time: 1800,
          light_sleep_duration: 12000,
          deep_sleep_duration: 6000,
          rem_sleep_duration: 9000,
          bedtime_start: '2025-03-14T22:00:00',
          bedtime_end: '2025-03-15T06:00:00',
        },
      ],
    };
    (mockPlatformCall as ReturnType<typeof vi.fn>).mockResolvedValue(mockSleepData);

    const result = await fetchOuraData(mockPlatformCall, 'sleep', '2025-03-15');

    expect(mockPlatformCall).toHaveBeenCalledWith('api_call', {
      api: 'oura',
      url: 'https://api.ouraring.com/v2/usercollection/sleep?start_date=2025-03-15&end_date=2025-03-15',
      method: 'GET',
    });
    expect(result).toEqual(mockSleepData.data[0]);
  });

  it('should fetch readiness data for today when no date provided', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const mockReadinessData = {
      data: [
        {
          id: 'def456',
          day: today,
          score: 78,
          contributors: {
            activity_balance: 80,
            body_temperature: 70,
            hrv_balance: 85,
            previous_day_activity: 75,
            previous_night: 82,
            recovery_index: 90,
            resting_heart_rate: 65,
            sleep_balance: 88,
          },
          temperature_deviation: 0.2,
          temperature_trend_deviation: 0.1,
        },
      ],
    };
    (mockPlatformCall as ReturnType<typeof vi.fn>).mockResolvedValue(mockReadinessData);

    const result = await fetchOuraData(mockPlatformCall, 'readiness');

    expect(mockPlatformCall).toHaveBeenCalledWith('api_call', {
      api: 'oura',
      url: `https://api.ouraring.com/v2/usercollection/readiness?start_date=${today}&end_date=${today}`,
      method: 'GET',
    });
    expect(result).toEqual(mockReadinessData.data[0]);
  });

  it('should throw if response has no data array', async () => {
    (mockPlatformCall as ReturnType<typeof vi.fn>).mockResolvedValue({});

    await expect(fetchOuraData(mockPlatformCall, 'activity', '2025-03-15')).rejects.toThrow(
      'Oura API returned invalid response for activity'
    );
  });

  it('should throw if data array is empty', async () => {
    (mockPlatformCall as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });

    await expect(fetchOuraData(mockPlatformCall, 'sleep', '2025-03-15')).rejects.toThrow(
      'No Oura sleep data found for 2025-03-15'
    );
  });
});

describe('health_fetch_oura tool handler', () => {
  it('should return success with data on valid call', async () => {
    const mockPlatform = {
      call: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'x',
            day: '2025-03-15',
            score: 90,
            contributors: {},
            duration: 0,
            total_sleep_duration: 0,
            awake_time: 0,
            light_sleep_duration: 0,
            deep_sleep_duration: 0,
            rem_sleep_duration: 0,
            bedtime_start: '',
            bedtime_end: '',
          },
        ],
      }),
    };

    const result = await health_fetch_oura(mockPlatform as any, { type: 'sleep', date: '2025-03-15' });
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  it('should return error on failure', async () => {
    const mockPlatform = {
      call: vi.fn().mockRejectedValue(new Error('API call failed')),
    };

    const result = await health_fetch_oura(mockPlatform as any, { type: 'readiness' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('API call failed');
  });
});
