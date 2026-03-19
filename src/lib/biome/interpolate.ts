import type { BiomeState } from './state';

export function easeOut(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function interpolateBiomeState(
  from: BiomeState,
  to: BiomeState,
  rawT: number,
): BiomeState {
  const t = Math.max(0, Math.min(1, rawT));

  return {
    pulse: Math.round(lerp(from.pulse, to.pulse, t)),
    recovery: Math.round(lerp(from.recovery, to.recovery, t)),
    strain: Math.round(lerp(from.strain, to.strain, t)),
    sleepQuality: Math.round(lerp(from.sleepQuality, to.sleepQuality, t)),
    dreaming: to.dreaming,
    dayPhase: to.dayPhase,
    weather: {
      condition: to.weather.condition,
      temp: lerp(from.weather.temp, to.weather.temp, t),
      windSpeed: lerp(from.weather.windSpeed, to.weather.windSpeed, t),
      windDirection: to.weather.windDirection,
    },
    lastUpdated: to.lastUpdated,
    dataAge: to.dataAge,
    stale: to.stale,
    sources: to.sources,
  };
}
