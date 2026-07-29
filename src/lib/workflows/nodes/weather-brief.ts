import type { NodeExecutor, NodeResult, ExecutionContext } from '../types';
import { interpolateTemplate } from './template';

export { weatherBriefDef } from './weather-brief.def';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

const CURRENT_FIELDS = 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,is_day';
const DAILY_FIELDS =
  'temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset';

/** WMO 4677 weather codes → plain English. Decoded here so no LLM has to guess. */
const WMO: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Heavy freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Violent showers',
  85: 'Light snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
};

function describe(code: unknown): string {
  const n = Number(code);
  return Number.isFinite(n) ? (WMO[n] ?? `Unknown conditions (WMO ${n})`) : 'Unknown conditions';
}

function num(v: unknown): number | null {
  if (typeof v === 'string' && !v.trim()) return null;
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Coordinate parsing has to be stricter than `num`. An unresolved template
 * (`{{input.current.lat}}` when the upstream lookup failed) interpolates to an
 * empty string, and `Number('')` is 0 — which would silently return weather for
 * 0°N 0°E in the Gulf of Guinea as though it were valid. Reject blanks and any
 * surviving template braces outright.
 */
function coord(raw: string, max: number): number | null {
  if (!raw.trim() || raw.includes('{{')) return null;
  const n = Number(raw);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

function bearingName(deg: number | null): string | null {
  if (deg === null) return null;
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return points[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Time-of-day HH:MM from an Open-Meteo local iso8601 string. */
function clock(iso: unknown): string | null {
  return typeof iso === 'string' && iso.includes('T') ? iso.split('T')[1].slice(0, 5) : null;
}

/**
 * Derived "local factors" — the things worth acting on today. Deterministic
 * thresholds so the same weather always yields the same warnings, and the
 * downstream LLM is never the thing deciding what counts as notable.
 */
function localFactors(w: {
  maxC: number | null;
  minC: number | null;
  precipProbMaxPct: number | null;
  precipMm: number | null;
  gustKph: number | null;
  uvIndexMax: number | null;
  condition: string;
}): string[] {
  const f: string[] = [];
  if (w.maxC !== null && w.maxC >= 30) f.push(`Very hot — ${w.maxC}°C peak, stay out of afternoon sun`);
  else if (w.maxC !== null && w.maxC >= 25) f.push(`Warm — ${w.maxC}°C peak`);
  if (w.maxC !== null && w.maxC <= 4) f.push(`Cold — ${w.maxC}°C peak`);
  if (w.minC !== null && w.minC <= 0) f.push(`Frost overnight — down to ${w.minC}°C`);
  if (w.maxC !== null && w.minC !== null && w.maxC - w.minC >= 15) {
    f.push(`Big swing — ${w.minC}°C to ${w.maxC}°C, layer up`);
  }
  if (w.precipProbMaxPct !== null && w.precipProbMaxPct >= 50) {
    const mm = w.precipMm !== null && w.precipMm > 0 ? `, ~${w.precipMm}mm` : '';
    f.push(`Rain likely (${w.precipProbMaxPct}%${mm})`);
  }
  if (w.uvIndexMax !== null && w.uvIndexMax >= 8) f.push(`Very high UV (index ${w.uvIndexMax})`);
  else if (w.uvIndexMax !== null && w.uvIndexMax >= 6) f.push(`High UV (index ${w.uvIndexMax})`);
  if (w.gustKph !== null && w.gustKph >= 60) f.push(`Strong gusts to ${Math.round(w.gustKph)} km/h`);
  else if (w.gustKph !== null && w.gustKph >= 45) f.push(`Blustery — gusts to ${Math.round(w.gustKph)} km/h`);
  if (/thunder/i.test(w.condition)) f.push(w.condition);
  if (/fog/i.test(w.condition)) f.push(`${w.condition} — allow extra travel time`);
  return f;
}

export const weatherBriefExecutor: NodeExecutor = {
  type: 'weather-brief',

  async execute(
    input: Record<string, unknown>,
    config: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<NodeResult> {
    const label = interpolateTemplate(String(config.label ?? ''), input).trim();
    const latRaw = interpolateTemplate(String(config.latitude ?? ''), input).trim();
    const lonRaw = interpolateTemplate(String(config.longitude ?? ''), input).trim();
    const timezone = interpolateTemplate(String(config.timezone ?? 'Europe/London'), input).trim() || 'Europe/London';

    const lat = coord(latRaw, 90);
    const lon = coord(lonRaw, 180);

    // No coordinates is the normal case when an upstream location lookup
    // failed — report it, never fall back to a default place.
    if (lat === null || lon === null) {
      return {
        output: {
          success: false,
          weather: null,
          error: `weather-brief: invalid coordinates (latitude "${latRaw || '(empty)'}", longitude "${lonRaw || '(empty)'}")`,
        },
        rowCount: 1,
      };
    }

    const url =
      `${ENDPOINT}?latitude=${lat}&longitude=${lon}` +
      `&current=${CURRENT_FIELDS}&daily=${DAILY_FIELDS}` +
      `&timezone=${encodeURIComponent(timezone)}&forecast_days=1`;

    let payload: Record<string, unknown>;
    try {
      const res = await fetch(url, { signal: context.abortSignal });
      if (!res.ok) {
        return {
          output: { success: false, weather: null, error: `Open-Meteo returned ${res.status} ${res.statusText}` },
          rowCount: 1,
        };
      }
      payload = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      return {
        output: {
          success: false,
          weather: null,
          error: `Open-Meteo request failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        rowCount: 1,
      };
    }

    const cur = (payload.current ?? {}) as Record<string, unknown>;
    const daily = (payload.daily ?? {}) as Record<string, unknown[]>;
    const first = (k: string): unknown => (Array.isArray(daily[k]) ? daily[k][0] : undefined);

    const maxC = num(first('temperature_2m_max'));
    const minC = num(first('temperature_2m_min'));
    const precipProbMaxPct = num(first('precipitation_probability_max'));
    const precipMm = num(first('precipitation_sum'));
    const gustKph = num(first('wind_gusts_10m_max'));
    const uvIndexMax = num(first('uv_index_max'));
    const condition = describe(cur.weather_code ?? first('weather_code'));

    const weather = {
      label: label || `${lat}, ${lon}`,
      lat,
      lon,
      // Open-Meteo snaps to a forecast grid — surface the point it actually used.
      gridLat: num(payload.latitude),
      gridLon: num(payload.longitude),
      timezone,
      observedAt: typeof cur.time === 'string' ? cur.time : null,
      date: typeof daily.time?.[0] === 'string' ? (daily.time[0] as string) : null,
      nowC: num(cur.temperature_2m),
      feelsLikeC: num(cur.apparent_temperature),
      condition,
      dayCondition: describe(first('weather_code')),
      isDay: cur.is_day === 1 || cur.is_day === '1',
      maxC,
      minC,
      precipProbMaxPct,
      precipMm,
      windKph: num(cur.wind_speed_10m),
      windDir: bearingName(num(cur.wind_direction_10m)),
      gustKph,
      uvIndexMax,
      sunrise: clock(first('sunrise')),
      sunset: clock(first('sunset')),
      factors: localFactors({ maxC, minC, precipProbMaxPct, precipMm, gustKph, uvIndexMax, condition }),
    };

    return { output: { success: true, weather, error: null }, rowCount: 1 };
  },

  getInputSchema() {
    return { type: 'object', description: 'Used for template interpolation of latitude / longitude / label' };
  },

  getOutputSchema() {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        weather: {
          type: 'object',
          description:
            '{ label, lat, lon, nowC, feelsLikeC, condition, maxC, minC, precipProbMaxPct, precipMm, windKph, windDir, gustKph, uvIndexMax, sunrise, sunset, factors[] } — °C and km/h',
        },
        error: { type: 'string', description: 'Why the lookup failed; null on success' },
      },
    };
  },
};
