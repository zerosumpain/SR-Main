// What the rambler wants: a handful of drives, each rising and falling on a
// known timescale, in place of a dice roll over a fixed table. jk's real day
// sets where they start; doing things moves them. He picks in proportion to
// how much each activity would relieve what is pressing (animals spread their
// behaviour in proportion to reward: Herrnstein's matching law), sticks at it
// until the need is mostly met, and goes off things he has just done for a
// while (habituation). Pure.
//
//   sleep      Borbély's two-process model: pressure builds with hours awake
//              (time constant 18.2 h), the circadian clock offsets it, with a
//              dip after lunch (Monk 2005).
//   restless   rises while he sits (breaking up sitting helps: Dunstan 2012).
//   attention  directed attention tires and is restored by green things and
//              views (Kaplan 1995).
//   stress     arousal without exercise behind it; exercise and slow
//              breathing bring it down.
//   appetite   a meal clock, and a cuppa at 11:00 and 15:30.
//   work       weekday working hours pull towards the desk.
//   curious    a steady low need for something new.
//   energy     not a need but a budget: hard things cost more when it is low.

import type { DayFlags } from './day';
import type { Reason } from './talk';

export type Drive = 'sleep' | 'restless' | 'attention' | 'stress' | 'appetite' | 'work' | 'curious' | 'energy';
export type Band = 'low' | 'mid' | 'high';
export type Sky = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'thunderstorm';

export interface DriveInput {
  /** Local hour, 0 to 24. */
  hour: number;
  weekday: boolean;
  sky: Sky;
  /** °C. */
  temp: number;
  /** Beats per minute, or null when no fresh reading. */
  pulse: number | null;
  day: DayFlags;
  /** Last night's sleep: short (under 6 h), normal, long (over 8 h). Null if unknown. */
  sleep: Band | null;
  /** Today's recovery band. Null if unknown. */
  recovery: Band | null;
}

export interface Drives {
  d: Record<Drive, number>;
  /** 0 to 1: how cold and how hot it is for him. */
  cold: number;
  hot: number;
  input: DriveInput;
  /** Where the clock and the day put each drive; play moves `d` away from it. */
  base: Record<Drive, number>;
  /** Parts of the sleep drive, for reasons. */
  dip: number;
  circadian: number;
  /** What his movement, pulse and clock add up to. */
  context: Context | null;
}

/** The activities the drives choose between; episodes (stressed, yawning...) are not here. */
export const CHOICES = [
  'wander',
  'run',
  'workout',
  'cycle',
  'garden',
  'lookout',
  'stargaze',
  'study',
  'think',
  'tv',
  'sofa',
  'nap',
  'sleep',
  'tea',
  'eat',
  'meditate',
  'drive',
  'puddle',
  'snowman',
  'umbrella',
] as const;
export type Choice = (typeof CHOICES)[number];

interface Effect {
  /** How much the activity relieves each drive, 0 to about 1. */
  r: Partial<Record<Drive, number>>;
  /** Energy cost, 0 to 1. */
  cost: number;
  /** Uses up directed attention (reading, thinking). */
  tires?: number;
  /** Sitting or lying: restlessness builds while he does it. */
  still?: boolean;
}

export const EFFECTS: Record<Choice, Effect> = {
  wander: { r: { restless: 0.35, curious: 0.5, attention: 0.15, stress: 0.2 }, cost: 0.15 },
  run: { r: { restless: 0.9, stress: 0.55 }, cost: 0.8 },
  workout: { r: { restless: 0.75, stress: 0.5 }, cost: 0.75 },
  cycle: { r: { restless: 0.6, curious: 0.35, stress: 0.2 }, cost: 0.55 },
  garden: { r: { attention: 0.7, stress: 0.45, restless: 0.3, curious: 0.2 }, cost: 0.35 },
  lookout: { r: { attention: 0.5, curious: 0.45, stress: 0.2 }, cost: 0.1, still: true },
  stargaze: { r: { attention: 0.6, curious: 0.55, stress: 0.2 }, cost: 0.05, still: true },
  study: { r: { work: 0.85, curious: 0.45 }, cost: 0.1, tires: 1, still: true },
  think: { r: { stress: 0.3, work: 0.35, curious: 0.3 }, cost: 0.05, tires: 0.5 },
  tv: { r: { attention: 0.55, sleep: 0.15 }, cost: 0, still: true },
  sofa: { r: { sleep: 0.4, attention: 0.45, stress: 0.2 }, cost: 0, still: true },
  nap: { r: { sleep: 0.95 }, cost: 0, still: true },
  sleep: { r: { sleep: 1.2 }, cost: 0, still: true },
  tea: { r: { appetite: 0.55, attention: 0.25, stress: 0.4 }, cost: 0, still: true },
  eat: { r: { appetite: 1.1 }, cost: 0, still: true },
  meditate: { r: { stress: 0.65, attention: 0.3 }, cost: 0, still: true },
  drive: { r: { curious: 0.4, work: 0.15 }, cost: 0.1, still: true },
  puddle: { r: { curious: 0.55, restless: 0.4, stress: 0.25 }, cost: 0.3 },
  snowman: { r: { curious: 0.6, restless: 0.35, attention: 0.3 }, cost: 0.35 },
  // The dry-day umbrella gag is curiosity with a punchline.
  umbrella: { r: { curious: 0.3, restless: 0.2 }, cost: 0.1 },
};

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const gauss = (x: number, m: number, s: number) => Math.exp(-((x - m) ** 2) / (2 * s * s));
const DRIVES: Drive[] = ['sleep', 'restless', 'attention', 'stress', 'appetite', 'work', 'curious', 'energy'];

/** Hours since an assumed 07:00 start. The real wake time is never read. */
export const awakeHours = (hour: number) => (hour - 7 + 24) % 24;

export function pulseBand(i: DriveInput): 'calm' | 'normal' | 'up' | 'high' {
  if (i.pulse === null) return 'normal';
  if (i.pulse >= 100 && !i.day.exercised) return 'high';
  if (i.pulse >= 90) return 'up';
  if (i.pulse < 65) return 'calm';
  return 'normal';
}

/**
 * What jk's movement, pulse and clock add up to, read together. A pulse
 * higher than movement explains ("additional heart rate", Blix et al. 1974;
 * Myrtek 2004) is a long-used marker of mental strain; the same pulse while
 * walking is just walking. Movement is the last 45 minutes of steps; the
 * pulse is the live reading. Null when either is missing or nothing stands out.
 */
export type Context = 'fuming' | 'workStress' | 'onEdge' | 'exerting' | 'focused' | 'deskBound' | 'outAndAbout' | 'windingDown';

export const CONTEXTS: Record<Context, { label: string; signals: string; reads: string; does: string }> = {
  fuming: {
    label: 'Fuming',
    signals: 'pulse 110 or more, sat still',
    reads: 'a racing heart with no movement to explain it, the strongest sign of strain',
    does: 'loses his temper (once a visit), then stressed episodes and a cross face while he walks',
  },
  workStress: {
    label: 'Stressed at work',
    signals: 'pulse 95 or more, sat still, weekday 09:00 to 17:30',
    reads: 'a raised pulse at a desk in working hours',
    does: 'clutches his head between activities, frets, reaches for tea or a breather, reads less',
  },
  onEdge: {
    label: 'On edge',
    signals: 'pulse 88 or more without much moving, or 95 or more outside working hours',
    reads: 'something is bothering him, not enough to boil over',
    does: 'arms folded, foot tapping, glancing about; meditating gets likelier',
  },
  exerting: {
    label: 'On the move',
    signals: 'pulse 90 or more, lots of steps lately',
    reads: 'a high pulse that exercise explains, which is not stress',
    does: 'runs and works out in sympathy; stress drops',
  },
  focused: {
    label: 'In the zone',
    signals: 'pulse under 70, sat still, weekday 09:00 to 17:30',
    reads: 'calm and still in working hours',
    does: 'reads and thinks for longer',
  },
  deskBound: {
    label: 'Desk-bound',
    signals: 'sat still, a low-step day, working hours',
    reads: 'a long sit with little else',
    does: 'gets restless and goes for a mooch or a run',
  },
  outAndAbout: {
    label: 'Out and about',
    signals: 'lots of steps lately, ordinary pulse',
    reads: 'walking somewhere',
    does: 'mooches, gardens and cycles more',
  },
  windingDown: {
    label: 'Winding down',
    signals: 'pulse under 65, sat still, late evening',
    reads: 'settling for the night',
    does: 'sofa, telly and bed sooner',
  },
};

export function contextFor(i: DriveInput): Context | null {
  const p = i.pulse;
  const mv = i.day.moving ?? null;
  const h = i.hour;
  const work = i.weekday && h >= 9 && h < 17.5;
  if (p !== null && mv) {
    if (p >= 90 && mv === 'active') return 'exerting';
    if (mv === 'still' && p >= 110) return 'fuming';
    if (mv === 'still' && p >= 95) return work ? 'workStress' : 'onEdge';
    if (mv !== 'active' && p >= 88) return 'onEdge';
    if (mv === 'still' && p < 70 && work) return 'focused';
    if (mv === 'still' && p < 65 && (h >= 21.5 || h < 6)) return 'windingDown';
  }
  if (mv === 'still' && work && i.day.steps === 'low') return 'deskBound';
  if (mv === 'active') return 'outAndAbout';
  return null;
}

function baseline(i: DriveInput) {
  const h = i.hour;
  const S0 = i.sleep === 'low' ? 0.45 : i.sleep === 'high' ? 0.12 : 0.22;
  // Process S builds through waking hours; Process C peaks in the early evening.
  const S = 1 - (1 - S0) * Math.exp(-awakeHours(h) / 18.2);
  const circadian = Math.cos((2 * Math.PI * (h - 18)) / 24);
  const dip = gauss(h, 14.5, 1);
  const sleep = clamp(1.25 * S - 0.22 * circadian + 0.18 * dip - 0.15);
  const restless = clamp((i.day.steps === 'low' ? 0.55 : i.day.steps === 'high' ? 0.2 : 0.35) - (i.day.exercised ? 0.15 : 0));
  const attention = clamp(i.weekday ? 0.1 + 0.06 * clamp(h - 9, 0, 9) : 0.15 + 0.02 * clamp(h - 9, 0, 12));
  const ctx = contextFor(i);
  // A pulse that movement explains is exercise, not stress.
  const pb = ctx === 'exerting' ? 'normal' : pulseBand(i);
  let stress = pb === 'high' ? 0.75 : pb === 'up' ? 0.45 : pb === 'calm' ? 0.08 : 0.22;
  stress = clamp(stress + (i.sky === 'thunderstorm' ? 0.15 : 0) + (i.recovery === 'low' ? 0.1 : 0) - (i.day.mindful ? 0.15 : 0));
  const meals = Math.max(gauss(h, 8, 0.8), gauss(h, 13, 0.8), gauss(h, 18.5, 0.9)) * 0.85;
  const cuppa = Math.max(gauss(h, 10.75, 0.6), gauss(h, 15.5, 0.6)) * 0.35;
  const appetite = clamp(Math.max(meals, 0.2 + cuppa));
  const work = i.weekday ? (h >= 9 && h < 17.5 ? 0.55 : h >= 17.5 && h < 21 ? 0.15 : 0.05) : 0.1;
  const energy = clamp((i.recovery === 'low' ? 0.45 : i.recovery === 'high' ? 0.92 : 0.7) - sleep * 0.3);
  const d: Record<Drive, number> = { sleep, restless, attention, stress, appetite, work, curious: 0.3, energy };
  switch (ctx) {
    case 'fuming':
      d.stress = Math.max(d.stress, 0.9);
      break;
    case 'workStress':
      d.stress = Math.max(d.stress, 0.78);
      d.attention = clamp(d.attention + 0.15);
      break;
    case 'onEdge':
      d.stress = clamp(Math.max(d.stress, 0.5), 0, 0.6);
      break;
    case 'exerting':
      // He moves in sympathy: jk on the go makes him want to go too.
      d.stress = clamp(d.stress - 0.2);
      d.restless = clamp(d.restless + 0.3);
      break;
    case 'focused':
      d.work = clamp(d.work + 0.2);
      d.stress = Math.min(d.stress, 0.15);
      break;
    case 'deskBound':
      d.restless = clamp(d.restless + 0.25);
      d.attention = clamp(d.attention + 0.1);
      break;
    case 'outAndAbout':
      d.restless = clamp(d.restless - 0.2);
      d.curious = clamp(d.curious + 0.1);
      break;
    case 'windingDown':
      d.sleep = clamp(d.sleep + 0.15);
      break;
  }
  return { d, dip, circadian, ctx };
}

export function startDrives(i: DriveInput): Drives {
  const b = baseline(i);
  return { d: { ...b.d }, base: { ...b.d }, cold: clamp((10 - i.temp) / 12), hot: clamp((i.temp - 22) / 8), input: i, dip: b.dip, circadian: b.circadian, context: b.ctx };
}

/** New readings: move each drive by however much its baseline moved, keeping what play has done. */
export function rebase(prev: Drives, i: DriveInput): Drives {
  const next = startDrives(i);
  for (const k of DRIVES) next.d[k] = clamp(prev.d[k] + next.base[k] - prev.base[k]);
  return next;
}

/** Place and weather: how possible each choice is right now, 0 to about 1. */
/** How the context leans each choice: he copes, mirrors or makes up for it. */
const LEAN: Partial<Record<Context, Partial<Record<Choice, number>>>> = {
  fuming: { meditate: 1.2, run: 1.5, study: 0.4 },
  workStress: { meditate: 1.2, tea: 1.5, wander: 1.3, study: 0.7, think: 0.8 },
  onEdge: { meditate: 1.6, tea: 1.2 },
  exerting: { run: 1.8, workout: 1.8, cycle: 1.5, sofa: 0.6 },
  focused: { study: 1.6, think: 1.6 },
  deskBound: { wander: 1.4, run: 1.4, study: 0.6 },
  outAndAbout: { wander: 1.5, garden: 1.5, cycle: 1.5 },
  windingDown: { sofa: 1.4, tv: 1.4, sleep: 1.4 },
};

export function gate(a: Choice, s: Drives): number {
  return place(a, s) * (s.context ? (LEAN[s.context]?.[a] ?? 1) : 1);
}

function place(a: Choice, s: Drives): number {
  const i = s.input;
  const h = i.hour;
  const wet = i.sky === 'rain' || i.sky === 'thunderstorm';
  const dark = h < 7 || h > 19.5;
  const night = h >= 22.5 || h < 6.5;
  switch (a) {
    case 'garden':
      return (dark ? 0.05 : 1) * (wet ? 0.15 : 1) * (i.sky === 'snow' ? 0.1 : 1) * (1 - 0.6 * s.cold) * (i.sky === 'clear' && !dark ? 1.4 : 1);
    case 'cycle':
      return (dark ? 0.2 : 1) * (wet || i.sky === 'snow' ? 0.1 : 1) * (i.day.cycled ? 1.8 : 1);
    case 'run':
      return (wet ? 0.5 : 1) * (night ? 0.1 : 1);
    case 'workout':
      return night ? 0.15 : 1;
    case 'lookout':
      // His favourite perch: sat on the pulse cell, legs dangling.
      return night && i.sky === 'clear' ? 0.3 : 1.8;
    case 'stargaze':
      return dark && i.sky === 'clear' ? 1.6 : 0;
    case 'sleep':
      return (night ? 1 : 0.03) * (s.d.sleep > 0.6 ? 1 : 0.2);
    case 'nap':
      return h >= 12 && h < 18 && s.d.sleep > 0.5 ? 1 : 0.05;
    case 'eat':
      return s.d.appetite > 0.45 ? 1 : 0.05;
    case 'study':
      return (i.weekday && h >= 9 && h < 17.5 ? 1.2 : 1) * (night ? 0.3 : 1);
    case 'drive':
      return (h >= 7 && h < 21 ? 1 : 0.1) * (wet ? 0.6 : 1);
    case 'tv':
      return h < 9 ? 0.4 : 1;
    case 'puddle':
      return wet && !dark ? 1 : 0;
    case 'snowman':
      return i.sky === 'snow' && !dark ? 1.4 : 0;
    case 'umbrella':
      return wet || i.sky === 'snow' ? 0 : 0.6;
    case 'meditate':
      return i.day.mindful ? 1.5 : 1;
    default:
      return 1;
  }
}

export interface Scored {
  a: Choice;
  /** Utility before randomness. */
  u: number;
  /** Probability of being picked. */
  p: number;
  /** The drive that did most for it. */
  top: Drive | null;
}

const urg = (x: number) => Math.pow(clamp(x), 1.5);
/** Softmax temperature: low enough to follow needs, high enough to stay alive. */
const TEMP = 0.1;

/** Every allowed choice, most likely first. `hab` is how fresh each choice feels, 0 to 1. */
export function score(s: Drives, hab: Partial<Record<Choice, number>> = {}, allowed: (a: Choice) => boolean = () => true): Scored[] {
  const out: (Scored & { w: number })[] = [];
  for (const a of CHOICES) {
    if (!allowed(a)) continue;
    const e = EFFECTS[a];
    let u = 0;
    let top: Drive | null = null;
    let topV = 0;
    for (const [k, w] of Object.entries(e.r) as [Drive, number][]) {
      const v = w * urg(s.d[k]);
      u += v;
      if (v > topV) {
        topV = v;
        top = k;
      }
    }
    u -= e.cost * (1 - s.d.energy) * 0.9;
    if (e.tires) u -= s.d.attention * 0.6 * e.tires;
    const w = gate(a, s) * (hab[a] ?? 1);
    if (w <= 0) continue;
    out.push({ a, u, p: 0, top, w });
  }
  if (!out.length) return [];
  const max = Math.max(...out.map((o) => o.u));
  let sum = 0;
  for (const o of out) {
    o.p = o.w * Math.exp((o.u - max) / TEMP);
    sum += o.p;
  }
  for (const o of out) o.p /= sum;
  out.sort((x, y) => y.p - x.p);
  return out.map(({ a, u, p, top }) => ({ a, u, p, top }));
}

/** Pick one in proportion to its odds. */
export function pick(scored: Scored[], random: () => number): Scored | null {
  let roll = random();
  for (const o of scored) {
    roll -= o.p;
    if (roll <= 0) return o;
  }
  return scored[scored.length - 1] ?? null;
}

/** How long to keep at it: until the drive behind it is mostly met (commitment). */
export function commitment(s: Drives, o: Scored): number {
  const level = o.top ? s.d[o.top] : 0.4;
  return 0.7 + 0.8 * level;
}

/** Doing `a` for `seconds` changes him. */
export function relieve(s: Drives, a: Choice, seconds: number) {
  const e = EFFECTS[a];
  const d = s.d;
  for (const [k, w] of Object.entries(e.r) as [Drive, number][]) d[k] = clamp(d[k] - w * 0.035 * seconds);
  if (e.still) d.restless = clamp(d.restless + 0.012 * seconds);
  if (e.tires) d.attention = clamp(d.attention + 0.025 * seconds * e.tires);
  d.energy = clamp(d.energy - e.cost * 0.015 * seconds + (e.cost === 0 ? 0.01 * seconds : 0));
  if (e.cost > 0.5) d.stress = clamp(d.stress - 0.01 * seconds);
  d.sleep = clamp(d.sleep + 0.0015 * seconds);
  d.appetite = clamp(d.appetite + 0.002 * seconds);
}

/** States that show on him whatever he is doing. */
export interface States {
  /** Boiling over: a mad episode, once a visit. */
  mad: boolean;
  sleepy: boolean;
  stressed: boolean;
  anxious: boolean;
  cold: boolean;
  hot: boolean;
}

export function states(s: Drives): States {
  return {
    mad: s.context === 'fuming',
    sleepy: s.d.sleep > 0.6,
    stressed: s.d.stress > 0.6,
    anxious: (s.d.stress > 0.4 && s.d.stress <= 0.6) || s.context === 'onEdge',
    cold: s.cold > 0.45,
    hot: s.hot > 0.5,
  };
}

/** Two needs nearly tied, both real: he dithers (a displacement activity). */
export function torn(scored: Scored[]): boolean {
  return scored.length > 1 && Math.abs(scored[0].u - scored[1].u) < 0.03 && scored[0].u > 0.25;
}

/** The reason to give for a choice, in the terms the voice card uses. */
export function reasonFor(s: Drives, o: Scored): Reason | undefined {
  const i = s.input;
  const pb = pulseBand(i);
  if (o.a === 'stargaze') return 'clearNight';
  if (o.a === 'puddle') return i.sky === 'thunderstorm' ? 'storm' : 'rain';
  if (o.a === 'snowman') return 'snow';
  if (o.a === 'garden' && i.sky === 'clear' && i.hour >= 7 && i.hour <= 19.5) return 'sun';
  if (o.a === 'cycle' && i.day.cycled) return 'cycled';
  const ctx = s.context;
  if (ctx === 'exerting' && (o.a === 'run' || o.a === 'workout' || o.a === 'cycle')) return 'exerting';
  if (ctx === 'focused' && (o.a === 'study' || o.a === 'think')) return 'focused';
  if (ctx === 'deskBound' && (o.top === 'restless' || o.a === 'wander' || o.a === 'run')) return 'deskBound';
  if (ctx === 'outAndAbout' && (o.a === 'wander' || o.a === 'garden' || o.a === 'cycle')) return 'outAndAbout';
  if (ctx === 'windingDown' && (o.a === 'sofa' || o.a === 'tv' || o.a === 'sleep')) return 'windingDown';
  if (o.top === 'stress' && ctx) {
    if (ctx === 'fuming') return 'fuming';
    if (ctx === 'workStress') return 'deskStress';
    if (ctx === 'onEdge') return 'onEdge';
  }
  switch (o.top) {
    case 'sleep':
      if (i.sleep === 'low') return 'shortNight';
      if (s.dip > 0.4) return 'lunchDip';
      if (i.hour >= 22 || i.hour < 6) return 'night';
      return 'sleepy';
    case 'restless':
      if (i.day.steps === 'low') return 'quietDay';
      if (i.day.exercised) return 'exercised';
      return 'sitting';
    case 'attention':
      return 'brainFull';
    case 'stress':
      if (pb === 'high' || pb === 'up') return 'pulseUp';
      if (i.sky === 'thunderstorm') return 'storm';
      if (i.recovery === 'low') return 'lowRecovery';
      return 'wound';
    case 'appetite':
      return Math.max(gauss(i.hour, 10.75, 0.6), gauss(i.hour, 15.5, 0.6)) > 0.5 ? 'teaTime' : 'hungry';
    case 'work':
      return 'workday';
    default:
      return undefined;
  }
}

/** The reason for a state episode (stressed, anxious, mad), if the context explains it. */
export function episodeReason(s: Drives): Reason | undefined {
  switch (s.context) {
    case 'fuming':
      return 'fuming';
    case 'workStress':
      return 'deskStress';
    case 'onEdge':
      return 'onEdge';
    default:
      return pulseBand(s.input) === 'high' ? 'pulseUp' : undefined;
  }
}
