export type WeatherCondition = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm';
export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';
export type RenderTier = 'webgl' | 'canvas' | 'static';

export interface BiomeState {
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
}

export const BIOME_DEFAULTS: BiomeState = {
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

export function cardiacPulse(time: number, bpm: number, intensity: number): number {
  const safeBpm = Math.max(bpm, 40);
  const period = 60 / safeBpm;
  const phase = (time % period) / period;
  // Use a small phase offset so beat is non-zero at phase=0 (systolic peak)
  const shiftedPhase = (phase + 0.05) % 1;
  const beat = Math.exp(-shiftedPhase * 6) * Math.pow(Math.sin(shiftedPhase * Math.PI), 0.5);
  return Math.max(0, Math.min(1, beat * (intensity / 100)));
}

export function windToVector(directionDeg: number, speed: number): [number, number] {
  const rad = (directionDeg * Math.PI) / 180;
  return [-Math.sin(rad) * speed, -Math.cos(rad) * speed];
}

export const DAY_PHASE_MAP: Record<DayPhase, number> = {
  night: 0,
  dawn: 1,
  day: 2,
  dusk: 3,
};

export const STALENESS_THRESHOLD = 21600;
export const POLL_INTERVAL = 900_000;
export const LERP_DURATION = 5000;
export const MAX_PARTICLES = 2000;
export const MAX_CONNECTION_SEGMENTS = 500;
export const CONNECTION_MAX_DIST = 1.5;
