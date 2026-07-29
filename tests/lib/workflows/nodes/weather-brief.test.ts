import { describe, it, expect, vi, afterEach } from 'vitest';
import { weatherBriefExecutor } from '$lib/workflows/nodes/weather-brief';
import type { ExecutionContext } from '$lib/workflows/types';

const ctx: ExecutionContext = {
  runId: 'test-run',
  workflowId: '',
  workspaceDir: '/tmp/test',
  dryRun: false,
  emit: () => {},
  getNodeOutput: () => undefined,
  checkBreakpoint: async () => {},
  abortSignal: new AbortController().signal,
  getOutgoingEdges: () => [],
  getIncomingEdges: () => [],
  getNodeConfig: () => undefined,
};

const PAYLOAD = {
  latitude: 52.25,
  longitude: 0.25,
  current: { time: '2026-07-29T08:30', temperature_2m: 22.7, apparent_temperature: 22.5, weather_code: 0, wind_speed_10m: 9.4, wind_direction_10m: 230, is_day: 1 },
  daily: {
    time: ['2026-07-29'],
    temperature_2m_max: [34.0],
    temperature_2m_min: [18.2],
    weather_code: [3],
    precipitation_probability_max: [0],
    precipitation_sum: [0],
    wind_speed_10m_max: [19.4],
    wind_gusts_10m_max: [38.9],
    uv_index_max: [5.5],
    sunrise: ['2026-07-29T05:15'],
    sunset: ['2026-07-29T20:55'],
  },
};

function mockFetch(payload: unknown, ok = true) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    statusText: ok ? 'OK' : 'Service Unavailable',
    json: async () => payload,
  } as Response);
}

afterEach(() => vi.restoreAllMocks());

type Out = { success: boolean; weather: Record<string, unknown> | null; error: string | null };
const run = (config: Record<string, unknown>, input: Record<string, unknown> = {}) =>
  weatherBriefExecutor.execute(input, config, ctx).then((r) => r.output as unknown as Out);

describe('weatherBriefExecutor', () => {
  it('decodes WMO codes and keeps metric units', async () => {
    mockFetch(PAYLOAD);
    const out = await run({ label: 'Cambridge', latitude: '52.19', longitude: '0.136' });
    expect(out.success).toBe(true);
    expect(out.weather?.condition).toBe('Clear');
    expect(out.weather?.dayCondition).toBe('Overcast');
    expect(out.weather?.maxC).toBe(34);
    expect(out.weather?.windDir).toBe('SW');
    expect(out.weather?.sunrise).toBe('05:15');
  });

  it('derives local factors from thresholds, not from a model', async () => {
    mockFetch(PAYLOAD);
    const out = await run({ label: 'Cambridge', latitude: '52.19', longitude: '0.136' });
    const factors = out.weather?.factors as string[];
    expect(factors.some((f) => f.includes('Very hot'))).toBe(true);
    expect(factors.some((f) => f.includes('Big swing'))).toBe(true);
    // Nothing to say about rain or wind today — so it says nothing.
    expect(factors.some((f) => /Rain|gust/i.test(f))).toBe(false);
  });

  it('refuses an unresolved template rather than returning 0°N 0°E weather', async () => {
    const spy = mockFetch(PAYLOAD);
    const out = await run({ label: 'Where I am', latitude: '{{input.current.lat}}', longitude: '{{input.current.lon}}' });
    expect(out.success).toBe(false);
    expect(out.weather).toBeNull();
    expect(out.error).toContain('invalid coordinates');
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses blank coordinates', async () => {
    const spy = mockFetch(PAYLOAD);
    const out = await run({ label: 'X', latitude: '', longitude: '' });
    expect(out.success).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('resolves coordinates from an upstream location-context payload', async () => {
    mockFetch(PAYLOAD);
    const out = await run(
      { label: '{{input.current.label}}', latitude: '{{input.current.lat}}', longitude: '{{input.current.lon}}' },
      { current: { lat: 52.190126, lon: 0.136185, label: 'Cambridge Leisure Park, England' } },
    );
    expect(out.success).toBe(true);
    expect(out.weather?.label).toBe('Cambridge Leisure Park, England');
    expect(out.weather?.lat).toBe(52.190126);
  });

  it('reports an API failure instead of a placeholder forecast', async () => {
    mockFetch({}, false);
    const out = await run({ label: 'Home', latitude: '54.52', longitude: '-1.57' });
    expect(out.success).toBe(false);
    expect(out.weather).toBeNull();
    expect(out.error).toContain('503');
  });
});
