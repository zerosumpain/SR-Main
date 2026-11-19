// What the rambler says when a visitor opens a private project on /projects.
// jk's voice, as in $lib/landing/ramblers/talk: dry, British, lower case, no
// exclamation marks and no colons. Unlike his landing-page lines these talk to
// the visitor — he is standing in front of them, so "you" means them.
//
// He wears thinner the more often he is called out. Four moods, by how many
// locked cards this visitor has opened lately: polite, then sassy, then
// direct and frustrated, then mad. Each mood has its own pose and face, and
// `{n}` in a line is the click count, said the way he would say it.

import type { Face, Mode } from '$lib/landing/ramblers/rig';
import { sayCount } from '$lib/projects/views';

export type Mood = 'polite' | 'sassy' | 'fed-up' | 'mad';

export interface MoodStyle {
  /** The front-on pose he holds while he says it. */
  mode: Mode;
  /** Faces to pick from (a line in this mood takes one). */
  faces: Face[];
}

export const MOOD_STYLE: Record<Mood, MoodStyle> = {
  // A wagging finger.
  polite: { mode: 'wave', faces: ['happy', 'neutral', 'confused'] },
  // Arms folded, a foot tapping.
  sassy: { mode: 'anxious', faces: ['tired', 'confused', 'neutral'] },
  // Hands on his head, sweating.
  'fed-up': { mode: 'stressed', faces: ['stressed'] },
  // Stamping, fists down, grawlix.
  mad: { mode: 'mad', faces: ['mad'] },
};

export const LOCKED_LINES: Record<Mood, string[]> = {
  polite: [
    "nope. this one's not for you",
    "private. jk hasn't even let me in, and i live here",
    "you'd need to be jk for this one. you're not, i checked",
    "members only. there aren't any members",
    "locked. i'd let you in but i've not got a key either",
    "still in its pants. come back when it's dressed",
    "nothing to see here. well, there is. you just can't see it",
    'off limits. jk says it builds character',
    "sorry, this one's behind the curtain",
    'not today. possibly not ever',
    "it's a work in progress. mostly progress. some work",
    "jk's still sanding the edges off this one",
    "this door's shut. the others are open, promise",
    'classified. by which i mean unfinished',
    "you've found the staff room. out you pop",
    "private. it's not you, it's the code",
    "ah. this is the bit we don't show the guests",
    'invitation only, and the invitations are lost',
    "not ready for company. it's in its dressing gown",
    "this one's under a dust sheet for now",
    "move along. there's a perfectly good marble race over there",
    'you need a share link for this one. ask nicely',
    "it's shy. give it time",
    'private. jk is very particular about who sees the mess',
    'this is where the half-finished things live',
    "not open to the public. barely open to jk",
    "it's resting. do not disturb",
    'behind this card is a lot of swearing at a compiler',
  ],
  sassy: [
    'still private. clicking harder won\'t help',
    'same door. still locked',
    "you again. it hasn't changed in the last ten seconds",
    'persistence is admirable. also pointless here',
    "i did say. i'll say it again, slower",
    "it's not a slot machine. it won't pay out",
    "the answer's still no, but nicely",
    'do you knock on locked doors twice as well',
    "that's a lot of clicking for a no",
    "still in its pants. that hasn't changed either",
    "have you tried the other cards. they're lovely",
    "it's not going to open because you asked again",
    "i admire the optimism. i don't share it",
    "yes, it's still private. i checked again, for you",
    "clicking it more doesn't make it less private",
    'that\'s {n} clicks. i\'m keeping count, by the way',
    "we've been through this",
    'i can do this all day. well, until my tea goes cold',
  ],
  'fed-up': [
    'right. stop it',
    'it is private. that is the whole point',
    "i'm running back and forth for this, you know",
    'my legs are thirteen pixels long. have a heart',
    'i have other things to do. well, i have tea',
    'this is getting silly now',
    'no. no. still no',
    "i'm not paid enough for this. i'm not paid at all",
    "you're wearing the button out",
    "the card isn't broken. it's just not for you",
    'look, ask jk for a link like everyone else',
    'every click, i run all the way over here. every one',
    "i'm starting to take this personally",
    'seriously. the other cards. go',
    "{n} clicks. i'm getting a stitch",
    "do you think i enjoy this. i don't",
  ],
  mad: [
    "that's it. i'm putting a fence up",
    'no. absolutely not. never',
    'i am not opening it. stop asking',
    'i will sit on this card if i have to',
    "i'm telling jk",
    'out. go on. out',
    '{n} times. {n}. go away',
    'this is a locked door and i am the lock',
    'do you want me cross. because this is me cross',
    'enough. go and watch the marbles or something',
    'the answer was no the first time. it is still no',
    "i've run a marathon for you today. no",
    'that card is closed. i am closed. we are all closed',
    "click it again. i dare you. actually, don't",
  ],
};

/** The mood for this visitor's nth locked card (n from 1). */
export function moodFor(n: number): Mood {
  if (n <= 2) return 'polite';
  if (n <= 4) return 'sassy';
  if (n <= 6) return 'fed-up';
  return 'mad';
}

export interface LockedSaying {
  text: string;
  mood: Mood;
  mode: Mode;
  face: Face;
}

/**
 * What he says on the nth click. `recent` holds the lines said lately (this
 * function adds to it) so the same one does not come round twice running.
 */
export function pickLockedLine(n: number, recent: string[] = [], roll: () => number = Math.random): LockedSaying {
  const mood = moodFor(n);
  const all = LOCKED_LINES[mood];
  const fresh = all.filter((l) => !recent.includes(l));
  const pool = fresh.length ? fresh : all;
  const raw = pool[Math.min(pool.length - 1, Math.floor(roll() * pool.length))];
  recent.push(raw);
  if (recent.length > 12) recent.shift();
  const style = MOOD_STYLE[mood];
  return {
    text: raw.replaceAll('{n}', sayCount(n)),
    mood,
    mode: style.mode,
    face: style.faces[Math.min(style.faces.length - 1, Math.floor(roll() * style.faces.length))],
  };
}

// How many locked cards this visitor has opened, kept for the tab so a reload
// does not reset his patience. A pause of five minutes does.
const KEY = 'sr-locked-clicks';
const PATIENCE_MS = 5 * 60_000;

export function countLockedClick(now = Date.now()): number {
  let n = 1;
  try {
    const was = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { n: number; at: number } | null;
    if (was && now - was.at < PATIENCE_MS) n = was.n + 1;
    sessionStorage.setItem(KEY, JSON.stringify({ n, at: now }));
  } catch {
    // Storage blocked: every click is his first. Fine.
  }
  return n;
}
