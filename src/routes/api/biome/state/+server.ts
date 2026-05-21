import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { appleHealthMetrics, whoopRecovery, whoopCycles } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import {
  BIOME_DEFAULTS,
  roundPulse,
  normalizeStrain,
  clamp100,
  isStale,
  type BiomeState,
  type WeatherCondition,
} from '$lib/biome/state';
import { getBiomeLocation } from '$lib/biome/location';
import type { RequestHandler } from './$types';

const WEATHER_CODES: Record<number, WeatherCondition> = {
  0: 'clear', 1: 'clear',
  2: 'cloudy', 3: 'cloudy',
  45: 'fog', 48: 'fog',
  51: 'rain', 53: 'rain', 55: 'rain', 56: 'rain', 57: 'rain',
  61: 'rain', 63: 'rain', 65: 'rain', 66: 'rain', 67: 'rain',
  71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow', 85: 'snow', 86: 'snow',
  80: 'rain', 81: 'rain', 82: 'rain',
  95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm',
};

function getDayPhase(isDay?: boolean): BiomeState['dayPhase'] {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 17 && hour < 19) return 'dusk';
  if (isDay === undefined) {
    return (hour >= 22 || hour < 5) ? 'night' : 'day';
  }
  return isDay ? 'day' : 'night';
}

export const GET: RequestHandler = async () => {
  const state: BiomeState = { ...BIOME_DEFAULTS };
  let latestDataTime: number | null = null;

  try {
    const [latestHR] = await db
      .select()
      .from(appleHealthMetrics)
      .where(eq(appleHealthMetrics.metricName, 'heart_rate'))
      .orderBy(desc(appleHealthMetrics.date))
      .limit(1);

    if (latestHR?.value) {
      state.pulse = roundPulse(latestHR.value / 100);
      latestDataTime = latestHR.date;
      state.sources.heartRate = true;
    }

    const [latestRecovery] = await db
      .select()
      .from(whoopRecovery)
      .orderBy(desc(whoopRecovery.createdDate))
      .limit(1);

    if (latestRecovery) {
      state.recovery = clamp100(latestRecovery.recoveryScore);
      if (!latestDataTime || latestRecovery.createdDate > latestDataTime) {
        latestDataTime = latestRecovery.createdDate;
      }
      state.sources.heartRate = true;
    }

    const [latestCycle] = await db
      .select()
      .from(whoopCycles)
      .orderBy(desc(whoopCycles.startDate))
      .limit(1);

    if (latestCycle) {
      state.strain = normalizeStrain(latestCycle.strain);
    }
  } catch (error) {
    console.error('[biome] DB fetch failed:', error);
  }

  const loc = await getBiomeLocation();
  state.town = loc.town ?? undefined;

  try {
    const params = new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      current: 'temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (res.ok) {
      const data = await res.json();
      const c = data.current;
      state.weather = {
        condition: WEATHER_CODES[c.weather_code] ?? 'cloudy',
        temp: c.temperature_2m,
        windSpeed: c.wind_speed_10m,
        windDirection: c.wind_direction_10m ?? 0,
      };
      state.dayPhase = getDayPhase(c.is_day === 1);
      state.sources.weather = true;
    }
  } catch (error) {
    console.error('[biome] Weather fetch failed:', error);
    state.dayPhase = getDayPhase();
  }

  if (latestDataTime) {
    state.dataAge = Math.round(Date.now() / 1000 - latestDataTime);
    state.lastSyncedAt = new Date(latestDataTime * 1000).toISOString();
  }
  state.stale = isStale(state.dataAge) || !state.sources.heartRate;
  state.lastUpdated = new Date().toISOString();

  return json(state, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
};
