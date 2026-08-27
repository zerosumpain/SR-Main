// src/lib/daydream/signals/weather.ts
//
// Weather where the person actually was.
//
// Home Assistant already has `weather.forecast_home` and it is deliberately not
// the source here. It reports met.no's view of the HOUSE, and half the days
// worth asking about are the ones spent somewhere else — a day out at Alton
// Towers under different sky is exactly the day a weather correlation would
// want, and home-coordinates weather would quietly answer for the wrong place.
// (The HA entity is still harvested by `ha.ts` like everything else, so both
// exist and can disagree, which is more useful than either alone.)
//
// So: Open-Meteo, keyed on each subject's own median position for the day.
// Free, no key, no attribution requirement, and already a trusted host in the
// `/api/jkai/cors` allow-list. Weather is therefore PER SUBJECT — two people in
// the family can be under different weather on the same day, and that is a
// distinction the observation store's `subject` column exists to keep.

import { and, gte, isNotNull, lte, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { daydreamPlaces, daydreamTrail } from '$lib/db/schema';
import { registerSignals, setObservations, signalKey, type Reading, type SignalSpec } from './registry';

/**
 * The daily variables worth a series, and their units.
 *
 * `weather_code` is deliberately absent: it is a categorical enumeration where
 * 61 is not "twice" 30, so correlating it would be arithmetic on a label. If a
 * category ever matters it belongs in the pack as a word, not in the sweep as a
 * number.
 */
export const WEATHER_VARIABLES: ReadonlyArray<{ api: string; label: string; unit: string }> = [
  { api: 'temperature_2m_mean', label: 'Temperature (mean)', unit: '°C' },
  { api: 'temperature_2m_max', label: 'Temperature (max)', unit: '°C' },
  { api: 'temperature_2m_min', label: 'Temperature (min)', unit: '°C' },
  { api: 'apparent_temperature_mean', label: 'Feels like (mean)', unit: '°C' },
  { api: 'precipitation_sum', label: 'Precipitation', unit: 'mm' },
  { api: 'rain_sum', label: 'Rain', unit: 'mm' },
  { api: 'snowfall_sum', label: 'Snowfall', unit: 'cm' },
  { api: 'precipitation_hours', label: 'Hours of precipitation', unit: 'h' },
  { api: 'wind_speed_10m_max', label: 'Wind speed (max)', unit: 'km/h' },
  { api: 'wind_gusts_10m_max', label: 'Wind gusts (max)', unit: 'km/h' },
  { api: 'shortwave_radiation_sum', label: 'Solar radiation', unit: 'MJ/m²' },
  { api: 'daylight_duration', label: 'Daylight', unit: 's' },
  { api: 'sunshine_duration', label: 'Sunshine', unit: 's' },
];

export const WEATHER_SPECS: SignalSpec[] = WEATHER_VARIABLES.map((v) => ({
  key: signalKey('weather', v.api),
  source: 'weather',
  label: v.label,
  unit: v.unit,
  valueKind: 'numeric',
}));

/** Open-Meteo's archive lags real time by about five days; the forecast
 *  endpoint serves recent days through `past_days`. Picking the wrong one is
 *  the difference between a full series and a silently truncated one. */
const ARCHIVE_LAG_DAYS = 6;

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Where a subject spent a day, to about a kilometre.
 *
 * The MEDIAN fix rather than the mean: a mean is dragged into a field halfway
 * along the motorway by a single day trip, whereas the median lands where the
 * time was actually spent. Rounded to 2dp (~1 km) before it is used as a cache
 * key, so a household that barely moved makes one request rather than five, and
 * so a precise coordinate is never what gets sent to a third party.
 */
export async function dailyPositions(
  from: string,
  to: string,
): Promise<Map<string, { lat: number; lon: number }>> {
  const rows = await db
    .select({ ts: daydreamTrail.ts, subject: daydreamTrail.subject, lat: daydreamTrail.lat, lon: daydreamTrail.lon })
    .from(daydreamTrail)
    .where(
      and(
        gte(daydreamTrail.ts, new Date(`${from}T00:00:00Z`)),
        lte(daydreamTrail.ts, new Date(`${to}T23:59:59Z`)),
        isNotNull(daydreamTrail.lat),
      ),
    );

  const buckets = new Map<string, { lats: number[]; lons: number[] }>();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' });
  for (const r of rows) {
    const key = `${r.subject}|${fmt.format(r.ts)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { lats: [], lons: [] }));
    b.lats.push(r.lat as number);
    b.lons.push(r.lon as number);
  }

  const mid = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const out = new Map<string, { lat: number; lon: number }>();
  for (const [key, b] of buckets) {
    out.set(key, {
      lat: Math.round(mid(b.lats) * 100) / 100,
      lon: Math.round(mid(b.lons) * 100) / 100,
    });
  }
  return out;
}

async function homeCoordinates(): Promise<{ lat: number; lon: number } | null> {
  const [home] = await db
    .select({ lat: daydreamPlaces.lat, lon: daydreamPlaces.lon })
    .from(daydreamPlaces)
    .where(and(eq(daydreamPlaces.kind, 'home'), eq(daydreamPlaces.status, 'active')))
    .limit(1);
  if (!home) return null;
  return { lat: Math.round(home.lat * 100) / 100, lon: Math.round(home.lon * 100) / 100 };
}

export interface DailyWeather {
  day: string;
  values: Record<string, number>;
}

/**
 * One Open-Meteo call for one location over one date range.
 *
 * Exported so the fetching is testable against a stubbed `fetch` without a
 * network — the parsing is where the mistakes live, not the URL.
 */
export async function fetchWeather(
  lat: number,
  lon: number,
  from: string,
  to: string,
  opts: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<DailyWeather[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const archiveCutoff = new Date(now.getTime() - ARCHIVE_LAG_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const daily = WEATHER_VARIABLES.map((v) => v.api).join(',');
  const base = to <= archiveCutoff ? ARCHIVE_URL : FORECAST_URL;
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    start_date: from,
    end_date: to,
    daily,
    timezone: 'Europe/London',
  });

  const res = await doFetch(`${base}?${params}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { daily?: Record<string, unknown[]> };
  const block = body.daily;
  if (!block || !Array.isArray(block.time)) return [];

  const out: DailyWeather[] = [];
  for (let i = 0; i < block.time.length; i++) {
    const values: Record<string, number> = {};
    for (const v of WEATHER_VARIABLES) {
      const col = block[v.api];
      const raw = Array.isArray(col) ? col[i] : null;
      // Open-Meteo returns null for a variable it has no value for. Absent
      // stays absent; a missing sunshine figure is not zero sunshine.
      if (typeof raw === 'number' && Number.isFinite(raw)) values[v.api] = raw;
    }
    out.push({ day: String(block.time[i]), values });
  }
  return out;
}

/**
 * Pull weather for every subject-day in a window, where each of them was.
 *
 * Requests are deduplicated by rounded coordinate AND date range, because a
 * household that stayed in together is one location, not five, and Open-Meteo
 * is a free service being used at its own suggestion rather than a paid one to
 * be leaned on.
 */
export async function backfillWeather(
  opts: { days?: number; now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<{ requested: number; subjectDays: number; written: number; errors: string[] }> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? 30;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const to = iso(now);
  const from = iso(new Date(now.getTime() - days * 86_400_000));
  const errors: string[] = [];

  await registerSignals(WEATHER_SPECS);

  const positions = await dailyPositions(from, to);
  const home = await homeCoordinates();

  // Group subject-days by the place they happened, so one request serves many.
  const byLocation = new Map<string, { lat: number; lon: number; entries: Array<{ subject: string; day: string }> }>();
  for (const [key, pos] of positions) {
    const [subject, day] = key.split('|');
    const locKey = `${pos.lat},${pos.lon}`;
    let g = byLocation.get(locKey);
    if (!g) byLocation.set(locKey, (g = { lat: pos.lat, lon: pos.lon, entries: [] }));
    g.entries.push({ subject, day });
  }

  if (byLocation.size === 0 && home) {
    errors.push('no positioned days in the window; nothing to key weather on');
  }

  let requested = 0;
  let written = 0;
  let subjectDays = 0;

  for (const group of byLocation.values()) {
    const dayList = [...new Set(group.entries.map((e) => e.day))].sort();
    if (dayList.length === 0) continue;
    try {
      requested++;
      const rows = await fetchWeather(group.lat, group.lon, dayList[0], dayList[dayList.length - 1], {
        fetchImpl: opts.fetchImpl,
        now,
      });
      const byDay = new Map(rows.map((r) => [r.day, r.values]));

      for (const entry of group.entries) {
        const values = byDay.get(entry.day);
        if (!values) continue;
        const readings: Reading[] = Object.entries(values).map(([api, value]) => ({
          key: signalKey('weather', api),
          subject: entry.subject,
          value,
        }));
        written += await setObservations(entry.day, readings);
        subjectDays++;
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { requested, subjectDays, written, errors };
}
