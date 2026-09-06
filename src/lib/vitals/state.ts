export type WeatherCondition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm';
export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';

/**
 * The site's live readings: John's vitals plus the weather where he is.
 *
 * One public request (`/api/vitals/state`) serves every surface that shows a
 * live number — the landing ECG's heart rate, the site header's bpm/°C cell,
 * the JKAI hub header and the landing Vital Signs rail — so no page opens a
 * second poll for the same reading.
 */
export interface VitalsState {
  pulse: number;
  recovery: number;
  strain: number;
  sleepQuality: number;
  dreaming: boolean;
  dayPhase: DayPhase;
  weather: {
    condition: WeatherCondition;
    temp: number;
    windSpeed: number;
    windDirection: number;
  };
  lastUpdated: string;
  dataAge: number;
  stale: boolean;
  sources: { heartRate: boolean; weather: boolean };
  /** Obfuscated (town-level) location label. Absent until resolved. */
  town?: string;
  /** ISO timestamp of the most recent vitals reading. */
  lastSyncedAt?: string;
}

export const VITALS_DEFAULTS: VitalsState = {
  pulse: 60,
  recovery: 50,
  strain: 38,
  sleepQuality: 50,
  dreaming: false,
  dayPhase: 'day',
  weather: { condition: 'clear', temp: 15, windSpeed: 5, windDirection: 225 },
  lastUpdated: new Date().toISOString(),
  dataAge: 0,
  stale: true,
  sources: { heartRate: false, weather: false },
};

export function roundPulse(bpm: number): number {
  return Math.round(bpm / 5) * 5;
}

export function normalizeStrain(strain: number): number {
  return clamp100((Math.max(0, Math.min(21, strain)) / 21) * 100);
}

export function clamp100(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function isStale(dataAge: number): boolean {
  return dataAge > 21600;
}

export const POLL_INTERVAL = 900_000;
export const LERP_DURATION = 5000;
