import { describe, it, expect, vi } from 'vitest';
import { fetchWeather, WEATHER_SPECS, WEATHER_VARIABLES } from './weather';

const NOW = new Date('2026-08-27T12:00:00Z');

function stub(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Server Error',
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('weather signals', () => {
  it('registers one signal per daily variable, each with a unit', () => {
    expect(WEATHER_SPECS).toHaveLength(WEATHER_VARIABLES.length);
    expect(WEATHER_SPECS.every((s) => s.source === 'weather' && s.unit)).toBe(true);
    expect(WEATHER_SPECS.map((s) => s.key)).toContain('weather:temperature_2m_mean');
  });

  it('does not sweep the weather code, which is a label not a quantity', () => {
    // 61 is not twice 30. Correlating an enumeration is arithmetic on a name.
    expect(WEATHER_VARIABLES.map((v) => v.api)).not.toContain('weather_code');
  });

  it('parses a daily block into one row per day', async () => {
    const f = stub({
      daily: {
        time: ['2026-08-01', '2026-08-02'],
        temperature_2m_mean: [17.4, 19.1],
        precipitation_sum: [0, 4.2],
      },
    });
    const rows = await fetchWeather(54.53, -1.55, '2026-08-01', '2026-08-02', {
      fetchImpl: f,
      now: NOW,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ day: '2026-08-01', values: { temperature_2m_mean: 17.4, precipitation_sum: 0 } });
    expect(rows[1].values.precipitation_sum).toBe(4.2);
  });

  it('keeps a genuine zero and drops a null — they are not the same', async () => {
    // No rain is a measurement. No sunshine figure is an absence.
    const f = stub({
      daily: {
        time: ['2026-08-01'],
        precipitation_sum: [0],
        sunshine_duration: [null],
      },
    });
    const [row] = await fetchWeather(54.53, -1.55, '2026-08-01', '2026-08-01', {
      fetchImpl: f,
      now: NOW,
    });
    expect(row.values.precipitation_sum).toBe(0);
    expect('sunshine_duration' in row.values).toBe(false);
  });

  it('uses the archive for old dates and the forecast endpoint for recent ones', async () => {
    // The archive lags about five days. Asking it for yesterday returns an
    // empty series that looks exactly like "there was no weather".
    const f = stub({ daily: { time: [] } });
    await fetchWeather(54.53, -1.55, '2026-06-01', '2026-06-30', { fetchImpl: f, now: NOW });
    expect(String((f as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain('archive-api');

    const f2 = stub({ daily: { time: [] } });
    await fetchWeather(54.53, -1.55, '2026-08-20', '2026-08-27', { fetchImpl: f2, now: NOW });
    expect(String((f2 as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain('api.open-meteo.com/v1/forecast');
  });

  it('asks in local time, so a day means the same thing as everywhere else here', async () => {
    const f = stub({ daily: { time: [] } });
    await fetchWeather(54.53, -1.55, '2026-06-01', '2026-06-02', { fetchImpl: f, now: NOW });
    const url = String((f as unknown as { mock: { calls: string[][] } }).mock.calls[0][0]);
    expect(url).toContain('timezone=Europe%2FLondon');
  });

  it('throws rather than returning an empty series when the API fails', async () => {
    // A silent empty result here would write "no weather" over real days.
    const f = stub({}, false);
    await expect(
      fetchWeather(54.53, -1.55, '2026-06-01', '2026-06-02', { fetchImpl: f, now: NOW }),
    ).rejects.toThrow(/open-meteo 500/);
  });
});
