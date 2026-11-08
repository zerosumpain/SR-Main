// The owner's day as the rambler feels it: the weather that follows him about
// (a raining cloud, an umbrella, a scarf on cold days) and the inputs his
// drives start from (see drives.ts). Pure.

import type { DayFlags } from './day';
import { CONTEXTS, contextFor, type Band, type DriveInput, type Sky } from './drives';

export type { Sky } from './drives';

export interface MoodInput {
  sky: Sky;
  /** °C. */
  temp: number;
  /** Beats per minute, or null when no fresh reading. */
  pulse: number | null;
  dayPhase: 'night' | 'dawn' | 'day' | 'dusk';
  day: DayFlags;
  /** Local hour, 0 to 24. Defaults from the day phase when absent. */
  hour?: number;
  weekday?: boolean;
  sleep?: Band | null;
  recovery?: Band | null;
}

export interface Mood {
  /** Weather that follows him: a cloud raining, snowing or storming. */
  cloud: 'rain' | 'snow' | 'storm' | null;
  /** He carries an umbrella whenever he walks. */
  umbrella: boolean;
  /** He wears his scarf. */
  scarf: boolean;
  /** Plain-words reasons, strongest first, for anyone curious. */
  why: string[];
  /** What his drives start from. */
  input: DriveInput;
}

const PHASE_HOUR = { night: 23, dawn: 7, day: 13, dusk: 19 } as const;

export function moodFor(m: MoodInput): Mood {
  const wet = m.sky === 'rain' || m.sky === 'thunderstorm';
  const cloud = m.sky === 'snow' ? 'snow' : m.sky === 'thunderstorm' ? 'storm' : m.sky === 'rain' ? 'rain' : null;
  const why: string[] = [];
  if (m.pulse !== null && m.pulse >= 100 && !m.day.exercised) why.push('your pulse is up');
  if (wet) why.push(m.sky === 'thunderstorm' ? 'there is a storm overhead' : 'it is raining');
  else if (m.sky === 'snow') why.push('it is snowing');
  else if (m.sky === 'clear' && m.dayPhase === 'day' && m.temp >= 10) why.push('the sun is out');
  if (m.temp < 5) why.push('it is cold out');
  if (m.dayPhase === 'night') why.push('it is night');
  if (m.day.exercised) why.push('you exercised today');
  if (m.day.mindful) why.push('you took a mindful moment');
  if (m.day.steps === 'low') why.push('a quiet day on your feet');
  else if (m.day.steps === 'high') why.push('a busy day on your feet');
  if (m.sleep === 'low') why.push('a short night');
  const ctx = contextFor({ hour: m.hour ?? PHASE_HOUR[m.dayPhase], weekday: m.weekday ?? true, sky: m.sky, temp: m.temp, pulse: m.pulse, day: m.day, sleep: null, recovery: null });
  if (ctx) why.unshift(CONTEXTS[ctx].reads);
  return {
    cloud,
    umbrella: wet,
    scarf: m.temp < 8,
    why,
    input: {
      hour: m.hour ?? PHASE_HOUR[m.dayPhase],
      weekday: m.weekday ?? true,
      sky: m.sky,
      temp: m.temp,
      pulse: m.pulse,
      day: m.day,
      sleep: m.sleep ?? null,
      recovery: m.recovery ?? null,
    },
  };
}

/** Before any readings arrive: a mild, ordinary weekday afternoon. */
export const CALM: Mood = moodFor({
  sky: 'cloudy',
  temp: 14,
  pulse: null,
  dayPhase: 'day',
  hour: 14,
  day: { steps: 'mid', exercised: false, climbed: false, cycled: false, walkedFar: false, mindful: false, outdoors: false },
});
