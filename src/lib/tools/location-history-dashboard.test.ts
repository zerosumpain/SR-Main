import { describe, it, expect, vi } from 'vitest';
import { locationHistoryDashboard } from './location-history-dashboard';

type PlatformCall = (tool: string, args: unknown) => Promise<unknown>;

function mockPlatform(call: PlatformCall) {
  return { call };
}

describe('locationHistoryDashboard', () => {
  it('should return error for invalid days', async () => {
    const platform = mockPlatform(vi.fn());
    const result = await locationHistoryDashboard({ days: 500 }, platform);
    expect(result.success).toBe(false);
    expect(result.message).toContain('must be a number between 1 and 365');
  });

  it('should return error for invalid format', async () => {
    const platform = mockPlatform(vi.fn());
    const result = await locationHistoryDashboard({ format: 'pie' as any }, platform);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid format');
  });

  it('should return early if no locations found', async () => {
    const call = vi.fn().mockResolvedValue({ success: true, locations: [] });
    const platform = mockPlatform(call);
    const result = await locationHistoryDashboard({ days: 7, format: 'table' }, platform);
    expect(result.success).toBe(true);
    expect(result.message).toContain('No locations found');
    expect(call).toHaveBeenCalledWith('location_history_aggregator', { days: 7 });
  });

  it('should generate table only', async () => {
    const locations = [
      { lat: 51.5, lon: -0.12, count: 10, address: 'London', timespent_minutes: 300 },
      { lat: 52.2, lon: 0.12, count: 3, address: 'Cambridge', timespent_minutes: 90 },
    ];
    const call = vi.fn();
    call.mockResolvedValueOnce({ success: true, locations });
    call.mockResolvedValueOnce({ url: 'https://viz.example.com/table/abc' });

    const platform = mockPlatform(call);
    const result = await locationHistoryDashboard({ days: 7, format: 'table' }, platform);
    expect(result.success).toBe(true);
    expect(result.tableUrl).toBe('https://viz.example.com/table/abc');
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith('location_history_aggregator', { days: 7 });
    expect(call).toHaveBeenCalledWith('visualise:render_table', expect.objectContaining({
      title: expect.stringContaining('Location History'),
      headers: ['#', 'Address', 'Visits', 'Time Spent (min)'],
    }));
  });

  it('should generate map only', async () => {
    const locations = [
      { lat: 51.5, lon: -0.12, count: 10, address: 'London' },
    ];
    const call = vi.fn();
    call.mockResolvedValueOnce({ success: true, locations });
    call.mockResolvedValueOnce({ url: 'https://viz.example.com/map/xyz' });

    const platform = mockPlatform(call);
    const result = await locationHistoryDashboard({ days: 7, format: 'map' }, platform);
    expect(result.success).toBe(true);
    expect(result.mapUrl).toBe('https://viz.example.com/map/xyz');
    expect(call).toHaveBeenCalledTimes(2);
    expect(call).toHaveBeenCalledWith('visualise:render_map', expect.objectContaining({
      title: expect.stringContaining('Location History Map'),
      markers: expect.arrayContaining([
        expect.objectContaining({ latitude: 51.5 }),
      ]),
    }));
  });

  it('should generate both table and map', async () => {
    const locations = [
      { lat: 51.5, lon: -0.12, count: 10, address: 'London', timespent_minutes: 300 },
    ];
    const call = vi.fn();
    call.mockResolvedValueOnce({ success: true, locations });
    call.mockResolvedValueOnce({ url: 'https://viz.example.com/table/abc' });
    call.mockResolvedValueOnce({ url: 'https://viz.example.com/map/xyz' });

    const platform = mockPlatform(call);
    const result = await locationHistoryDashboard({ days: 7, format: 'both' }, platform);
    expect(result.success).toBe(true);
    expect(result.tableUrl).toBe('https://viz.example.com/table/abc');
    expect(result.mapUrl).toBe('https://viz.example.com/map/xyz');
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('should handle aggregator failure', async () => {
    const call = vi.fn().mockResolvedValue({ success: false, message: 'Some error' });
    const platform = mockPlatform(call);
    const result = await locationHistoryDashboard({ days: 7 }, platform);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Some error');
  });

  it('should handle aggregator throw', async () => {
    const call = vi.fn().mockRejectedValue(new Error('Network error'));
    const platform = mockPlatform(call);
    const result = await locationHistoryDashboard({ days: 7 }, platform);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Network error');
  });

  it('should handle render tool failure gracefully', async () => {
    const locations = [{ lat: 51.5, lon: -0.12, count: 1, address: 'Home' }];
    const call = vi.fn();
    call.mockResolvedValueOnce({ success: true, locations });
    call.mockRejectedValueOnce(new Error('Render service unavailable'));

    const platform = mockPlatform(call);
    const result = await locationHistoryDashboard({ days: 7, format: 'table' }, platform);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Render service unavailable');
    expect(result.tableUrl).toBeUndefined();
  });
});
