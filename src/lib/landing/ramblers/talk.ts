// What the rambler says and thinks, in jk's voice: dry, British, lower case,
// self-deprecating, the joke never explained. No exclamation marks (jk earns
// one now and then; a bubble reaching for one reads as enthusiasm) and no
// colons, after the voice card in data/voice.
// A thought bubble when he decides what to do next (what he wants); a speech
// bubble now and then while he is at it (what he is doing). When the owner's
// day is the reason he chose something, he says so — that is how a visitor
// learns he is wired to a real person. The owner is "jk", never "you": a
// visitor would read "you" as themselves. Pure apart from the random source.

import type { Activity } from './resident';

export type Reason =
  | 'rain'
  | 'storm'
  | 'snow'
  | 'sun'
  | 'cold'
  | 'night'
  | 'dusk'
  | 'pulseUp'
  | 'calm'
  | 'exercised'
  | 'climbed'
  | 'cycled'
  | 'walked'
  | 'mindful'
  | 'outdoors'
  | 'quietDay'
  | 'busyDay'
  | 'clearNight'
  | 'shortNight'
  | 'lunchDip'
  | 'sleepy'
  | 'sitting'
  | 'brainFull'
  | 'lowRecovery'
  | 'wound'
  | 'teaTime'
  | 'hungry'
  | 'workday'
  | 'deskStress'
  | 'fuming'
  | 'onEdge'
  | 'exerting'
  | 'focused'
  | 'deskBound'
  | 'outAndAbout'
  | 'windingDown';

export interface Line {
  text: string;
  kind: 'say' | 'think';
}

/** What he is off to do. */
const WANT: Record<Activity, string[]> = {
  wander: ['going for a mooch', 'just having a nosey', 'stretching the legs'],
  run: ['cardio. allegedly', 'right, a quick lap', 'running, for some reason'],
  lookout: ['up top for a nosey', 'king of the monitor'],
  stargaze: ['clear night. telescope', 'off to count stars'],
  study: ['one more chapter, honest', 'reading. ish'],
  think: ['having a think', 'smooth brain, engage'],
  workout: ['gains, theoretically', 'right, exercise. ugh'],
  drive: ['keys, wallet, phone, car', 'popping out in the car'],
  cycle: ['on yer bike', 'quick spin on the bike'],
  sleep: ['resting my eyes', 'five minutes. tops'],
  nap: ['power nap. nasa said', 'twenty minutes, max'],
  garden: ['green fingers, allegedly', 'going to grow something'],
  tv: ["what's on the telly", 'just the one episode'],
  sofa: ['feet up, brain off', 'sofa. earned it, probably'],
  tea: ['kettle on', 'brew time'],
  eat: ['food. now', 'something on toast'],
  meditate: ['breathe in. allegedly', 'right, being calm'],
  puddle: ['puddles, obviously', 'wellies on'],
  snowman: ['building a lad', 'snowman o clock'],
  umbrella: ['lovely day for a walk', 'not a cloud in the sky'],
  stressed: ['everything is fine', 'too many tabs open'],
  anxious: ['did i leave the oven on', 'something feels off'],
  mad: ['oh come on', 'brilliant. just brilliant'],
  surprised: ['what was that'],
  fidget: ['now what was i doing', 'decisions, decisions'],
  shiver: ['baltic', 'should have worn a coat'],
  yawn: ['eyes are going'],
  celebrate: ['get in', 'look at that'],
  fan: ['too hot for this', 'is it me or'],
};

/** Why — said first, when the owner's day is what tipped the choice. */
const BECAUSE: Record<Reason, string> = {
  rain: 'raining, obviously.',
  storm: 'thunder. lovely.',
  snow: 'snow. nope.',
  sun: "sun's out, rare that.",
  cold: 'baltic out there.',
  night: 'past my bedtime.',
  dusk: 'getting dark.',
  pulseUp: "jk's pulse is up.",
  calm: "jk's pulse is horizontal.",
  exercised: 'jk trained, so now i have to.',
  climbed: 'jk did the stairs.',
  cycled: 'jk was on the bike.',
  walked: 'jk walked miles.',
  mindful: 'jk did some breathing.',
  outdoors: 'jk saw daylight.',
  quietDay: 'jk barely moved today.',
  busyDay: "jk's legs are done.",
  clearNight: 'clear sky tonight.',
  shortNight: 'jk slept badly.',
  lunchDip: 'post-lunch slump.',
  sleepy: 'eyes are heavy.',
  sitting: 'been sat too long.',
  brainFull: 'brain full.',
  lowRecovery: 'running on empty.',
  wound: 'bit wound up.',
  teaTime: 'tea time.',
  hungry: 'stomach rumbling.',
  workday: 'it is a work day.',
  deskStress: "jk's sat still, pulse racing.",
  fuming: 'jk is quietly seething.',
  onEdge: "jk's a bit on edge.",
  exerting: "jk's on the move.",
  focused: "jk's in the zone.",
  deskBound: "jk hasn't moved in ages.",
  outAndAbout: "jk's out and about.",
  windingDown: "jk's winding down.",
};

/** What he mutters while he is at it. */
const DOING: Partial<Record<Activity, string[]>> = {
  study: ['reading the same line again', 'this is a good bit'],
  think: ['what if... no', 'ooo shiny idea'],
  workout: ['one more. maybe', 'why do people do this'],
  garden: ['go on, grow then', 'nature is healing'],
  tv: ['one more episode', 'who is that again'],
  sofa: ['this is the life', 'not moving now'],
  stressed: ['this is fine', 'inbox zero, my foot'],
  anxious: ['did i lock the door', 'was that my phone'],
  lookout: ['pulse looks alright', 'nice view of the traces'],
  drive: ['mirror, signal, mooch'],
  umbrella: ['typical', 'should have checked the forecast'],
  tea: ['proper brew, this', 'milk in last, fight me'],
  eat: ['this is good', 'crumbs everywhere'],
  nap: ['zzz'],
  meditate: ['in. and out', 'very calm. very calm'],
  cycle: ['no hands. no, hands', 'mind the pothole'],
  stargaze: ['is that a planet', 'that one is a plane'],
  puddle: ['splosh', 'that one was deep'],
  snowman: ['he needs a carrot', 'looks a bit like jk'],
};

const WET = ['proper british weather', 'glad i brought this'];

export const SPECIAL = {
  hello: 'alright?',
  caught: '!',
  chasing: 'oi, wait up',
  found: 'there you are',
} as const;

const pick = <T>(xs: readonly T[], random: () => number) => xs[Math.floor(random() * xs.length) % xs.length];

/** The thought as he sets off: what he wants, and why if the day decided it. */
export function want(activity: Activity, reason: Reason | undefined, random: () => number = Math.random): Line {
  const wish = pick(WANT[activity], random);
  return { text: reason ? `${BECAUSE[reason]} ${wish}` : wish, kind: 'think' };
}

/** Something to say partway through, or null if he has nothing to add. */
export function aside(activity: Activity, wet: boolean, random: () => number = Math.random): Line | null {
  const lines = wet && (activity === 'wander' || activity === 'run') ? WET : DOING[activity];
  return lines?.length ? { text: pick(lines, random), kind: 'say' } : null;
}

/** Break a line into rows of at most `width` characters, at spaces. */
export function wrap(text: string, width = 22): string[] {
  const rows: string[] = [];
  for (const word of text.split(' ')) {
    const last = rows[rows.length - 1];
    if (last !== undefined && last.length + 1 + word.length <= width) rows[rows.length - 1] = `${last} ${word}`;
    else rows.push(word);
  }
  return rows;
}
