// wildmind-words.ts — the Wildmind chapter's shared words, in every view's
// voice: what someone is doing, how the chapter stands, and the one-sentence
// text equivalent of the map. Built only from enums, counts and bounded names
// (see wildmind.ts), never from anything the minds wrote.
//
// Every line about a person starts with the person's name, so "asleep" can
// never be read as being about me. Figures come through countWord and
// ordinalWord, so no literal here carries a digit.

import { countWord } from './sentence';
import { CAUSE, type Cause, type Weather, type WildmindPerson, type WildmindShowcase } from './wildmind';

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/** "first" … "twelfth", then "13th", "21st", "102nd". */
export function ordinalWord(n: number): string {
  if (n >= 1 && n <= ORDINALS.length && Number.isInteger(n)) return ORDINALS[n - 1];
  const teen = Math.abs(n) % 100;
  const last = Math.abs(n) % 10;
  const suffix = teen >= 11 && teen <= 13 ? 'th' : last === 1 ? 'st' : last === 2 ? 'nd' : last === 3 ? 'rd' : 'th';
  return `${n.toLocaleString('en-GB')}${suffix}`;
}

/** What someone died of, after "died of": "the cold", "hunger". Null when it was not recorded. */
export function causeWord(cause: Cause | null | undefined): string | null {
  return cause ? CAUSE[cause] : null;
}

/** How long a life lasted: "less than a day", "a day", "three days", "32 days". */
export function daysWord(days: number): string {
  if (!(days >= 1)) return 'less than a day';
  const n = Math.round(days);
  return n === 1 ? 'a day' : `${countWord(n)} days`;
}

/** An earlier life with its place in the line: `n` is its generation, null when that isn't known. */
export type PlacedLife = { n: number | null; days: number; cause: Cause | null };

export interface LineOfLives {
  /** Every listed life, newest first (earlierLives' order), each with its generation when known. */
  lives: PlacedLife[];
  /** The list runs back unbroken from this life (or the one just ended) to the first. */
  unbroken: boolean;
  /** Every listed life has its generation, so each can be called "the fifth". */
  numbered: boolean;
  /** Between lives, the life that has just ended, when it is listed. */
  ended: PlacedLife | null;
  /** The lives before this one (or before the one just ended), newest first. */
  before: PlacedLife[];
}

/**
 * Where each earlier life sits in the line. Wildmind leaves some lives out, so
 * earlierLives runs unbroken back from this generation (or, between lives,
 * from the one just ended, which leads it) only when every life's own `n` says
 * so, or, with no numbers, when its length says so. Otherwise each life keeps
 * its own `n` when every one has a valid one, strictly descending, and failing
 * that none has a number (between lives the one leading the list is still the
 * one just ended). The copy then describes only the lives listed.
 */
export function lineOfLives(w: Pick<WildmindShowcase, 'state' | 'generation' | 'earlierLives'>): LineOfLives {
  const g = w.generation;
  const between = w.state === 'between-lives';
  const list = w.earlierLives;
  const top = g == null ? null : between ? g : g - 1;
  const valid = (n: unknown, i: number): boolean =>
    typeof n === 'number' && Number.isInteger(n) && n >= 1 && (g == null || n <= g) && (i === 0 || n < (list[i - 1].n as number));
  const own = list.every((l, i) => valid(l.n, i));
  const lives: PlacedLife[] = list.map((l, j) => ({
    n: own ? (l.n as number) : top != null && list.length === top ? top - j : between && j === 0 && g != null ? g : null,
    days: l.days,
    cause: l.cause,
  }));
  const unbroken = top != null && lives.length === top && lives.every((l, j) => l.n === top - j);
  const ended = between && lives.length && (lives[0].n == null || lives[0].n === g) ? lives[0] : null;
  return { lives, unbroken, numbered: lives.every((l) => l.n != null), ended, before: ended ? lives.slice(1) : lives };
}

/** An earlier life without its number, in turn: "one", "a later one", "another". */
export function unnumberedWord(i: number, first = 'one'): string {
  return i === 0 ? first : i === 1 ? 'a later one' : 'another';
}

/** The weather as a word that follows "it's" or "a … day". */
export const WEATHER_WORD: Record<Weather, string> = {
  clear: 'clear',
  cloudy: 'cloudy',
  rain: 'raining',
  storm: 'stormy',
  snow: 'snowing',
  fog: 'foggy',
};

/** "JKai is asleep near Mirror Mere", "Wren is at work", "JKai is dead". Always the name first. */
export function doingWord(p: Pick<WildmindPerson, 'name' | 'doing' | 'alive' | 'near'>, place = true): string {
  if (!p.alive) return `${p.name} is dead`;
  return place && p.near ? `${p.name} is ${p.doing} near ${p.near}` : `${p.name} is ${p.doing}`;
}

/** "Most", "About half", "Some" (of their choices are habit). Null with none yet. */
export function habitWord(share: WildmindShowcase['habitShare']): string | null {
  return share === 'most' ? 'Most' : share === 'about-half' ? 'About half' : share === 'some' ? 'Some' : null;
}

/** "thinks with Haiku and invents with Sonnet". Null when the models are not known. */
export function modelsLine(models: WildmindShowcase['models']): string | null {
  if (!models) return null;
  if (models.mind === models.designer) return `thinks and invents with ${models.mind}`;
  return `thinks with ${models.mind} and invents with ${models.designer}`;
}

/** The main character's name (JKai unless the snapshot says otherwise). */
export function mainName(w: Pick<WildmindShowcase, 'people'>): string {
  return w.people.find((p) => p.id === 'main')?.name ?? 'JKai';
}

/** "one place", "nineteen places". */
export function counted(places: number): string {
  return `${countWord(places)} ${places === 1 ? 'place' : 'places'}`;
}

/** Names joined in prose: "JKai", "JKai and Wren", "A, B and C". */
export function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The line that says how the valley stands when it is not simply live, in
 * game time only (never a clock time). Null when live.
 */
export function stateLine(w: WildmindShowcase): string | null {
  switch (w.state) {
    case 'live':
      return null;
    case 'resting':
      return "Their minds are resting till tomorrow, so they're getting by on habit.";
    case 'paused':
      return "The valley's paused just now.";
    case 'between-lives': {
      const cause = causeWord(lineOfLives(w).ended?.cause);
      const name = mainName(w);
      const when = w.day != null ? ` on day ${countWord(w.day)}` : '';
      const died = cause ? `${name} died of ${cause}${when}.` : `${name} died${when}.`;
      return `${died} The next of the line wakes up in a fresh valley shortly.`;
    }
    case 'stale':
      return w.day != null
        ? `This is how the valley stood on day ${countWord(w.day)}. It isn't answering just now.`
        : "The valley isn't answering just now.";
    default:
      return "The valley isn't answering just now.";
  }
}

/**
 * The map's text equivalent, one or two sentences, for beside the figure (or
 * visually hidden where the caption is already prose):
 * "A map of the land JKai and Wren have seen so far, where they've named
 * nineteen places. JKai is walking near Tusker Wood and Wren is at work near
 * Bittern Beds." Only some of the names are ever written on the map (a
 * dozen or so, fewer on a phone), so it never says they are all "on it".
 */
export function mapSummary(w: WildmindShowcase, hasMap = w.map != null): string {
  if (!hasMap) return w.state === 'offline' ? "The valley isn't answering just now, so there's no map of it." : 'The map of the valley is still being drawn.';
  const names = w.people.map((p) => p.name);
  const places = w.map?.labels.length ?? 0;
  const who = names.length ? `the land ${andList(names)} ${names.length === 1 ? 'has' : 'have'} seen so far` : 'the land seen so far';
  const where = places ? `, where ${names.length === 1 ? `${names[0]} has` : 'they’ve'} named ${counted(places)}` : '';
  const doing = w.people.map((p) => doingWord(p));
  return `A map of ${who}${where}.${doing.length ? ` ${andList(doing)}.` : ''}`;
}
