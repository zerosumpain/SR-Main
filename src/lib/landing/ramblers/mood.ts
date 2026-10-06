// How the owner's day leans the rambler: the weather where he is, his pulse,
// the time of day and what he has done today all multiply the odds of each
// activity. Nothing is forced — a sunny day makes gardening likely, not
// constant — so he still looks like he has a life of his own. Pure.

import type { DayFlags } from './day';
import type { Activity } from './resident';
import type { Reason } from './talk';

export type Sky = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm';

export interface MoodInput {
  sky: Sky;
  /** °C. */
  temp: number;
  /** Beats per minute, or null when no fresh reading. */
  pulse: number | null;
  dayPhase: 'night' | 'dawn' | 'day' | 'dusk';
  day: DayFlags;
}

export interface Mood {
  /** Multiplier per activity; absent means 1. */
  odds: Partial<Record<Activity, number>>;
  /** Weather that follows him about: a cloud raining, snowing or storming. */
  cloud: 'rain' | 'snow' | 'storm' | null;
  /** He carries an umbrella whenever he walks. */
  umbrella: boolean;
  /** Plain-words reasons, strongest first, for anyone curious. */
  why: string[];
  /** For each activity the day made likelier, the strongest reason why. */
  because: Partial<Record<Activity, Reason>>;
}

export const CALM: Mood = { odds: {}, cloud: null, umbrella: false, why: [], because: {} };

export function moodFor(m: MoodInput): Mood {
  const odds: Partial<Record<Activity, number>> = {};
  const why: string[] = [];
  const because: Partial<Record<Activity, Reason>> = {};
  const strongest: Partial<Record<Activity, number>> = {};
  const lean = (acts: Activity[], by: number, reason?: Reason) => {
    for (const a of acts) {
      odds[a] = (odds[a] ?? 1) * by;
      if (reason && by > 1 && by > (strongest[a] ?? 1)) {
        strongest[a] = by;
        because[a] = reason;
      }
    }
  };

  const wet = m.sky === 'rain' || m.sky === 'thunderstorm';
  const cloud = m.sky === 'snow' ? 'snow' : m.sky === 'thunderstorm' ? 'storm' : m.sky === 'rain' ? 'rain' : null;
  if (wet) {
    lean(['umbrella', 'tv', 'sofa'], 2.5, m.sky === 'thunderstorm' ? 'storm' : 'rain');
    lean(['garden', 'drive'], 0.3);
    why.push(m.sky === 'thunderstorm' ? 'there is a storm overhead' : 'it is raining');
  } else if (m.sky === 'snow') {
    lean(['tv', 'sofa'], 2, 'snow');
    lean(['garden'], 0.2);
    why.push('it is snowing');
  } else if (m.sky === 'clear' && m.dayPhase === 'day' && m.temp >= 10) {
    lean(['garden'], 3, 'sun');
    lean(['wander', 'run'], 1.4, 'sun');
    why.push('the sun is out');
  }
  if (m.temp < 5) {
    lean(['sofa', 'tv'], 1.6, 'cold');
    lean(['garden'], 0.5);
    why.push('it is cold out');
  }
  if (m.sky === 'thunderstorm') lean(['anxious'], 2, 'storm');

  if (m.dayPhase === 'night') {
    lean(['sleep'], 3, 'night');
    lean(['tv', 'sofa'], 2, 'night');
    why.push('it is night');
  } else if (m.dayPhase === 'dusk') {
    lean(['tv', 'sofa'], 1.8, 'dusk');
  }

  // A pulse that is high without exercise behind it reads as stress.
  if (m.pulse !== null) {
    if (m.pulse >= 100 && !m.day.exercised) {
      lean(['stressed', 'anxious'], 4, 'pulseUp');
      lean(['sofa', 'sleep'], 0.5);
      why.unshift('your pulse is up');
    } else if (m.pulse >= 90) {
      lean(['anxious'], 2, 'pulseUp');
    } else if (m.pulse < 65) {
      lean(['sofa', 'tv', 'lookout'], 1.6, 'calm');
      lean(['stressed', 'anxious'], 0.4);
      why.push('your pulse is calm');
    }
  }

  const d = m.day;
  if (d.exercised) {
    lean(['workout', 'run'], 2.5, 'exercised');
    why.push('you exercised today');
  }
  if (d.climbed) {
    lean(['lookout'], 2.5, 'climbed');
    why.push('you climbed stairs today');
  }
  if (d.cycled) lean(['drive'], 2, 'cycled');
  if (d.walkedFar) lean(['wander'], 1.8, 'walked');
  if (d.mindful) {
    lean(['think', 'sofa'], 2, 'mindful');
    lean(['stressed', 'anxious'], 0.4);
    why.push('you took a mindful moment');
  }
  if (d.outdoors) lean(['garden'], 1.8, 'outdoors');
  if (d.steps === 'low') {
    lean(['sofa', 'tv'], 1.8, 'quietDay');
    why.push('a quiet day on your feet');
  } else if (d.steps === 'high') {
    lean(['run', 'wander'], 1.6, 'busyDay');
    why.push('a busy day on your feet');
  }

  return { odds, cloud, umbrella: wet, why, because };
}
