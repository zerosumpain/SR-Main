// showcase-place-wildmind.ts — the place view's fifth chapter, Wildmind: "a
// model under glass".
//
// At the end of the street there is a gallery with a big shop window.
// Inside, under a glass vitrine on a plinth, stands an architect's planning
// model of the valley the two people with Claude for minds have seen so far,
// in card and birch ply, a layer for every step of height (the model is
// built on the server: wildmind-glass.server.ts). Two tiny painted figures
// stand on it where they are now, or lie down when they're asleep, and a
// bronze plaque on the plinth says what they made up lately. People on the
// pavement look in. By day you see it through the street's reflections;
// after dark the gallery's spotlights make it the warmest window on the
// street (GlassArt.svelte draws it all).
//
// This module is the scene's geometry and everything worked out from the
// data, pure: where the board stands in the scene, where the people's labels
// anchor (they are the only labels that move), which huts get a model of
// their own, and the words. It reads only the allow-listed public shape
// (wildmind.ts): counts, enums, game time and bounded names, never anything
// anyone in the valley thought or said. Time is the valley's own ("day
// eighteen"). A missing figure is a dash or a missing clause, never a
// nought. It imports nothing from the sentence or notes views' modules, so
// the place view's chunk carries none of their code.

import { countWord } from './sentence';
import type { Box } from './showcase-place';
import type { Tag } from './showcase-place-words';
import { luminance } from './sky';
import { MODEL_FALLBACK, type WildmindPerson, type WildmindShowcase } from './wildmind';
import { BOARD } from './wildmind-glass';
import {
  WEATHER_ADJ,
  andList,
  causeWord,
  counted,
  doingWord,
  habitWord,
  isStill,
  lineOfLives,
  livesSentence,
  mainName,
  ordinalWord,
  pastDoing,
  sentenceCase,
  sorted,
  stateLine,
} from './wildmind-words';

/* ---------------------------------------------------------------- geometry */

const BOARD_FRONT = 479;

/**
 * The scene, in its own units (1000 wide, 600 high, the street at 566):
 * the gallery's front (`building`, running off the right edge), its shop
 * `window` (the bed at 548), the `fascia` over it, the `plinth` and the
 * `vitrine` on it, the model's `board` (back-left corner; BOARD.w × BOARD.d),
 * the line the people's words stand on (`labelY`, on the gallery's back
 * wall, above the vitrine) and where their leaders turn (`jogY`, at the
 * words' foot, so a leader that must jog runs along under them), the three
 * track `spots`, the `door` the walk's footpath ends at, the paused card,
 * and the part kept when the picture is cropped (`zone` on a tablet, the
 * tighter `phoneZone` on a phone, where the model fills the width).
 */
export const GALLERY = {
  h: 600,
  ground: 566,
  building: { x: 424, top: 52, r: 1040 },
  window: { x: 450, y: 150, w: 520, h: 398 },
  fascia: { x: 440, y: 116, w: 540, h: 24 },
  plinth: { x: 482, w: 456, top: 486 },
  board: { x: 710 - BOARD.w / 2, y: BOARD_FRONT - BOARD.d },
  vitrine: { x: 710 - BOARD.w / 2 - 12, w: BOARD.w + 24, back: BOARD_FRONT - BOARD.d - 46, front: 447, foot: 483 },
  labelY: 268,
  /** How far down the glass the sky's reflection reaches by day: above the people's words. */
  skyStrip: 32,
  /** Where a leader turns along to its label: right under the words, well clear of the vitrine's back edge. */
  jogY: 268,
  spots: [596, 710, 824],
  door: { x: 984, w: 40, top: 300 },
  card: { x: 520, y: 494, w: 76, h: 42 },
  zone: [400, 1000] as [number, number],
  phoneZone: [468, 952] as [number, number],
} as const;

/** A point on the board (board units) in the scene. */
export function onBoard(p: { x: number; y: number }): { x: number; y: number } {
  return { x: GALLERY.board.x + p.x, y: GALLERY.board.y + p.y };
}

/** A painted figure on the model: where it stands in the scene (on the card under it), and how. */
export interface Figure {
  id: WildmindPerson['id'];
  x: number;
  y: number;
  asleep: boolean;
  alive: boolean;
}

/** The painted figures: drawn this much bigger than their own units, and how far up their tops are (a head standing, a shoulder lying down). */
export const FIGURE = { scale: 1.35, stand: 13.6, lie: 5.6 } as const;

/** Where a figure's leader starts: its top, in scene units above the point it stands on. */
export function figureTop(asleep: boolean): number {
  return r1((asleep ? FIGURE.lie : FIGURE.stand) * FIGURE.scale + 1.5);
}

/** How far the people's labels may reach: a label whose words run left is anchored at least this far across, one whose words run right at most this far. */
export const CLAMP = { l: 650, r: 770 } as const;
/** The least gap between two people's anchors, so their words never touch. */
export const ANCHOR_GAP = 16;

export interface PersonAnchor {
  id: WildmindPerson['id'];
  /** The figure on the model, in scene units: where its leader starts. */
  x: number;
  y: number;
  /** Where the label stands on the back wall, and which way its words run. */
  at: number;
  hang: 'l' | 'r';
  /** The leader in the scene: up from the figure, along to the anchor when they differ, up to the words. */
  lead: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The leader from a figure to its label's anchor on the back wall. */
export function leaderPath(x: number, y: number, at: number): string {
  if (Math.abs(x - at) < 0.5) return `M${r1(x)},${r1(y)}V${GALLERY.labelY}`;
  const turn = `M${r1(x)},${r1(y)}V${GALLERY.jogY}H${r1(at)}`;
  return GALLERY.jogY === GALLERY.labelY ? turn : `${turn}V${GALLERY.labelY}`;
}

/**
 * Where the people's labels stand: each up from its figure through the lid
 * to the back wall over the vitrine. Of two, the left one's words run left
 * and the right one's right, so they always run apart; a lone person's run
 * toward the middle. Anchors are kept where the words stay on the back wall
 * (CLAMP) and apart (ANCHOR_GAP); where that moves one off its figure, its
 * leader jogs along under the words.
 */
export function peopleAnchors(people: Array<{ id: WildmindPerson['id']; x: number; y: number }>): PersonAnchor[] {
  const xs = [...people].sort((a, b) => a.x - b.x || (a.id === 'main' ? -1 : 1));
  const mk = (p: (typeof xs)[number], at: number, hang: 'l' | 'r'): PersonAnchor => ({
    id: p.id,
    x: r1(p.x),
    y: r1(p.y),
    at: r1(at),
    hang,
    lead: leaderPath(p.x, p.y, at),
  });
  if (!xs.length) return [];
  if (xs.length === 1) {
    const p = xs[0];
    const hang = p.x < 710 ? 'r' : 'l';
    return [mk(p, hang === 'r' ? Math.min(CLAMP.r, p.x) : Math.max(CLAMP.l, p.x), hang)];
  }
  const [l, r] = [xs[0], xs[xs.length - 1]];
  let a = Math.max(CLAMP.l, l.x);
  let b = Math.min(CLAMP.r, r.x);
  if (b - a < ANCHOR_GAP) {
    const mid = Math.min(CLAMP.r - ANCHOR_GAP / 2, Math.max(CLAMP.l + ANCHOR_GAP / 2, (a + b) / 2));
    a = mid - ANCHOR_GAP / 2;
    b = mid + ANCHOR_GAP / 2;
  }
  return [mk(l, a, 'l'), mk(r, b, 'r')];
}

/** The most huts modelled, and how close two may stand (board units) before one stands for both. */
export const HUT_CAP = 14;
export const HUT_CELL = 9;

export interface HutSpot {
  x: number;
  y: number;
  lit: boolean;
  done: boolean;
}

/**
 * What they've built, as card huts on the model: one hut for every patch a
 * hut wide (a lit one wins, then a finished one), at most HUT_CAP of them,
 * farthest first so the nearer stand in front. A hut where a figure stands
 * (whoever sleeps in it) is set just behind and beside them, as the model
 * maker would, so the figure is never lost inside it.
 */
export function gatherHuts(things: HutSpot[], figures: Array<{ x: number; y: number }> = [], cell = HUT_CELL, cap = HUT_CAP): HutSpot[] {
  const by = new Map<string, HutSpot>();
  for (const t of things) {
    const key = `${Math.round(t.x / cell)}:${Math.round(t.y / cell)}`;
    const had = by.get(key);
    if (!had || (t.lit && !had.lit) || (t.done && !had.done && t.lit === had.lit)) by.set(key, t);
  }
  return [...by.values()]
    .sort((a, b) => Number(b.lit) - Number(a.lit) || Number(b.done) - Number(a.done))
    .slice(0, cap)
    .map((h) => (figures.some((f) => Math.abs(f.x - h.x) < 9 && Math.abs(f.y - h.y) < 5) ? { ...h, x: r1(h.x - 11), y: r1(h.y - 1.5) } : h))
    .sort((a, b) => a.y - b.y);
}

/** The most animals drawn as specks. */
export const SPECK_CAP = 160;

/* ------------------------------------------------------------------- light */

/**
 * The gallery's light, for the drawing and for the contrast test: the back
 * wall the people's words stand on (by night and by day), and the strongest
 * the spotlights' pools and cones may be where the words stand. The words
 * carry PlaceTags' dark halo too, but are held to 4.5:1 without it.
 */
export const GALLERY_LIGHT = {
  wallNight: '#1b1510',
  /** By day: a warm daylit room (GlassArt adds a little of the sun's colour, and the light gathering low). */
  wallDay: '#41382d',
  lamp: '#ffd9a0',
  /** A pool of lamplight on the back wall: its centre, height, and alpha at its centre and halfway out (radial stops 0 and 0.55). */
  pool: { cy: 352, ry: 150, rx: 100, peak: 0.36, half: 0.12 },
  cone: 0.13,
} as const;

/** The band the people's words occupy on the back wall, at any width. */
export const WORDS_BAND: Box = { x: GALLERY.window.x, y: GALLERY.labelY - 84, w: GALLERY.window.w, h: 84 };

/** The pool's alpha at a height on the back wall (the radial gradient, straight below or above its centre). */
export function poolAlpha(y: number): number {
  const P = GALLERY_LIGHT.pool;
  const r = Math.abs(y - P.cy) / P.ry;
  if (r >= 1) return 0;
  return r <= 0.55 ? P.peak + (P.half - P.peak) * (r / 0.55) : P.half * (1 - (r - 0.55) / 0.45);
}

/** The back wall's colour where the people's words stand, at its brightest (full night, under a pool and a cone). */
export function wordsGround(): string {
  const [wr, wg, wb] = hexRgb(GALLERY_LIGHT.wallNight);
  const [lr, lg, lb] = hexRgb(GALLERY_LIGHT.lamp);
  const a = poolAlpha(WORDS_BAND.y + WORDS_BAND.h);
  const over = (base: number[], top: number[], k: number) => base.map((v, i) => v * (1 - k) + top[i] * k);
  const c = over(over([wr, wg, wb], [lr, lg, lb], a), [lr, lg, lb], GALLERY_LIGHT.cone);
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * The back wall where the people's words stand at its brightest by day: the
 * daylit wall with as much of the sun's colour as GlassArt gives it (15% of
 * the city's sunlit tone at its strongest, --city-sun-on 0.44, taken as a
 * pale gold) and the lamps at their daytime glow (--gl-on 0.22).
 */
export function dayWordsGround(): string {
  const over = (base: number[], top: number[], k: number) => base.map((v, i) => v * (1 - k) + top[i] * k);
  const sunlit = over(hexRgb(GALLERY_LIGHT.wallDay), hexRgb('#ffe6b8'), 0.15 * 0.44);
  const c = over(sunlit, hexRgb(GALLERY_LIGHT.lamp), 0.22 * poolAlpha(WORDS_BAND.y + WORDS_BAND.h));
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function hexRgb(h: string): number[] {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Contrast of cream at 86% on a ground. */
export function creamOn(ground: string): number {
  const g = hexRgb(ground);
  const c = [237, 228, 212].map((v, i) => v * 0.86 + g[i] * 0.14);
  const hi = luminance(c);
  const lo = luminance(g);
  return (Math.max(hi, lo) + 0.05) / (Math.min(hi, lo) + 0.05);
}

/* ------------------------------------------------------------------- words */

export type WmTag = Tag & { id: 'main' | 'companion' | 'latest' | 'model'; tone: 'accent' | 'ink'; long?: boolean };

export interface WildmindPlaceWords {
  head: { kicker: string; title: string; unit: string; aside?: string; figure: number | null; dateline?: string };
  key: string;
  rules: string;
  /** What the "hold still" row says while they move, once held, and under reduced motion; null when nothing moves. */
  captions: { moving: string; held: string; reduced: string } | null;
  close: string;
  /** The picture's text equivalent, said beside it (never live). */
  summary: string;
  tags: WmTag[];
  /** Extra lines for the printed list. */
  print: Array<{ dt: string; dd: string }>;
}

/* copy:start — words only below this line; every figure comes from data. */

const OPEN = 'A little world I’m building where';
const NOT_ANSWERING = 'not answering just now';
const FAMILIES = 'which is roughly how families work too.';
const MODEL_LINE = 'The model in the window is the land they’ve seen so far, a layer of card for every step of height, and it grows as they walk.';

/**
 * Under the figure, in the valley's own time, never ours: "day two · spring ·
 * in the valley, a clear night". The valley's night can fall on a sunny
 * street, so where the line says day or night it says whose.
 */
function dateline(w: WildmindShowcase): string | undefined {
  const day = w.day != null ? `day ${countWord(w.day)}` : null;
  const join = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(' · ') || undefined;
  switch (w.state) {
    case 'live':
      return join(day, w.season, w.weather ? `in the valley, a ${WEATHER_ADJ[w.weather]} ${(w.night ?? 0) >= 0.5 ? 'night' : 'day'}` : 'in the valley');
    case 'resting':
      return join(day, 'minds resting till tomorrow');
    case 'paused':
      return join(day, 'paused just now');
    case 'between-lives':
      return 'between lives';
    case 'stale':
      return join(day, 'as it stood');
    default:
      return undefined;
  }
}

function keyText(w: WildmindShowcase): string {
  const main = mainName(w);
  const two = w.people.length === 2 ? 'two ' : '';
  const what = `${OPEN} ${two}people have Claude for a mind.`;
  const live = `${what} They start in a valley with nothing and have to think up anything they want. ${MODEL_LINE}`;
  // Resting or paused, the line about how it all starts makes way for how it stands, so the plate keeps its length.
  switch (w.state) {
    case 'live':
      return live;
    case 'resting':
      return `${what} ${MODEL_LINE} Their minds are resting till tomorrow, so they’re getting by on habit.`;
    case 'paused':
      return `${what} ${MODEL_LINE} It’s paused just now, so everyone’s stopped where they stood.`;
    case 'between-lives':
      return `${OPEN} the people have Claude for a mind. ${stateLine(w)} Till then the model stays in the window as ${main} left it.`;
    case 'stale':
      return `${what}${w.day != null ? ` This is how their valley stood on day ${countWord(w.day)}.` : ''} It isn’t answering just now, so the model shows it as it stood.`;
    default:
      return `${OPEN} the people have Claude for a mind. The sheet’s on because the valley isn’t answering just now, not because they’ve stopped.`;
  }
}

function rulesText(w: WildmindShowcase): string {
  const first = 'It runs on a box in the house whether anyone’s watching or not.';
  if (w.state === 'offline') return first;
  const past = w.state === 'between-lives';
  const m = w.models;
  const models =
    m && m.mind !== MODEL_FALLBACK && m.designer !== MODEL_FALLBACK
      ? m.mind === m.designer
        ? `They ${past ? 'thought and invented' : 'think and invent'} with ${m.mind}`
        : `They ${past ? 'thought' : 'think'} with ${m.mind} and ${past ? 'invented' : 'invent'} with ${m.designer}`
      : null;
  let ref: string | null = null;
  if (w.refused === 0) ref = past ? 'never turned any of their ideas down' : 'hasn’t turned any of their ideas down yet';
  else if (w.refused != null) {
    const ideas = w.refused === 1 ? 'one of their ideas' : `${countWord(w.refused)} of their ideas`;
    ref = past ? `turned down ${ideas}` : `has turned down ${ideas} so far`;
  }
  if (models && ref) return `${first} ${models}, and the referee in the code ${ref}.`;
  if (models) return `${first} ${models}.`;
  if (ref) return `${first} The referee in the code ${ref}.`;
  return first;
}

/** "About half of what either of them does is habit by now, …", in the state's tense, or null with none yet. */
function habitSentence(w: WildmindShowcase): string | null {
  const h = habitWord(w.habitShare);
  if (!h) return null;
  const s = w.habitShare;
  if (w.state === 'between-lives')
    return s === 'some'
      ? `${h} of what either of them did was habit, though most of it still needed thinking about.`
      : s === 'about-half'
        ? `${h} of what either of them did was habit, and the rest still needed thinking about.`
        : `${h} of what either of them did was habit, so the model only got woken when something was new.`;
  if (w.state === 'resting')
    return s === 'most'
      ? `${h} of what either of them does is habit by now, which is as well with their minds resting.`
      : `${h} of what either of them does is habit ${s === 'some' ? 'already' : 'by now'}, and the rest waits till their minds are back.`;
  return s === 'some'
    ? `${h} of what either of them does is habit already, though most of it still needs thinking about.`
    : s === 'about-half'
      ? `${h} of what either of them does is habit by now, and the rest still needs thinking about.`
      : `${h} of what either of them does is habit by now, so the model only gets woken when something’s new.`;
}

/** ", and the third of the line. The first lasted … When one dies, …", or "." with no line. */
function lineTail(w: WildmindShowcase): string {
  const gen = w.generation;
  if (gen == null) return '.';
  if (gen === 1) return ', and the first of the line, so nobody’s had to pass anything on yet.';
  const lives = livesSentence(w);
  return `, and the ${ordinalWord(gen)} of the line.${lives ? ` ${lives}` : ''} When one dies, Claude reads back over the life and leaves the next a few lessons, ${FAMILIES}`;
}

const stillWord = (w: WildmindShowcase) => (w.state === 'paused' ? 'paused' : w.state === 'stale' ? 'as it stood' : null);

function mainTag(w: WildmindShowcase, p: WildmindPerson): WmTag {
  const main = p.name;
  if (w.state === 'between-lives' || !p.alive) {
    const cause = causeWord(lineOfLives(w).ended?.cause);
    const day = w.state === 'between-lives' && w.day != null ? `on day ${countWord(w.day)}` : null;
    const sub = [cause ? `of ${cause}` : null, day].filter(Boolean).join(', ');
    return {
      id: 'main',
      kicker: main,
      value: 'died',
      sub: sub || undefined,
      tone: 'accent',
      note: `${main} died${cause ? ` of ${cause}` : ''}${day ? ` ${day}` : ''}. The empty base on the model is where they fell. Claude is reading back over their life now to leave the next one a few lessons, ${FAMILIES}`,
    };
  }
  const still = stillWord(w);
  const sub = [p.near ? `near ${p.near}` : null, still].filter(Boolean).join(', ');
  return {
    id: 'main',
    kicker: main,
    value: p.doing,
    sub: sub || undefined,
    tone: 'accent',
    note: still ? `${pastDoing(p, false)} when it stopped. They’re the orange one${lineTail(w)}` : `${main}’s the orange one${lineTail(w)}`,
  };
}

function companionTag(w: WildmindShowcase, p: WildmindPerson): WmTag {
  const past = w.state === 'between-lives';
  const main = mainName(w);
  const woke = past
    ? w.met === true
      ? ` They woke up in the same valley and met ${main} along the way.`
      : w.met === false
        ? ` They woke up in the same valley and never met ${main}.`
        : ' They woke up in the same valley.'
    : w.met === true
      ? ' They woke up in the same valley, and they’ve met since.'
      : w.met === false
        ? ` They woke up in the same valley and haven’t met ${main} yet.`
        : ' They woke up in the same valley.';
  const places = w.placesFound;
  const named = places ? (past ? ` Between them they’d named ${counted(places)}.` : ` Between them they’ve named ${counted(places)} so far.`) : '';
  const habit = habitSentence(w);
  const still = stillWord(w);
  const sub = [p.near ? `near ${p.near}` : null, still].filter(Boolean).join(', ');
  return {
    id: 'companion',
    kicker: p.name,
    value: p.alive ? p.doing : 'died',
    sub: sub || undefined,
    tone: 'ink',
    note: `${p.name}’s the blue one.${woke}${named}${habit ? ` ${habit}` : ''}`,
  };
}

/** The bronze plaque on the plinth: what they made up lately. Null with no count. */
function latestTag(w: WildmindShowcase): WmTag | null {
  if (w.invented == null) return null;
  const past = w.state === 'between-lives';
  const note =
    `The plaque says what they ${past ? 'made up last' : 'made up lately'}. Every tool, shelter and basket starts as an idea from one of them, and a second model turns it into a working design. ` +
    'The count includes the in-between stuff too, like twine and reed mats.';
  const base = { id: 'latest' as const, kicker: 'Made up lately', tone: 'accent' as const, note };
  if (w.invented === 0) return { ...base, value: past ? 'nothing' : 'nothing yet' };
  if (!w.latest.length) return { ...base, value: countWord(w.invented), unit: w.invented === 1 ? 'thing' : 'things' };
  const sub = w.invented === 1 ? (past ? 'the only thing they made' : 'the only thing so far') : w.latest[1] ? `before that, ${sentenceCase(w.latest[1])}` : undefined;
  return { ...base, value: sentenceCase(w.latest[0]), sub, long: true };
}

const SHEET_TAG: WmTag = {
  id: 'model',
  kicker: 'The model',
  value: 'under a sheet',
  sub: NOT_ANSWERING,
  tone: 'ink',
  note: 'The valley isn’t answering just now, so the model’s under a dust sheet. It comes off by itself when the valley answers again.',
};

/** The drawing's text equivalent: what's in the window, in the state's tense. */
function modelSummary(w: WildmindShowcase, built: boolean): string {
  if (w.state === 'offline') return 'The model in the window is under a dust sheet, because the valley isn’t answering just now.';
  if (!built) return 'The model of the valley is still being built.';
  const people = sorted(w);
  const names = andList(people.map((p) => p.name));
  const ended = w.state === 'between-lives';
  if (isStill(w)) {
    const land = names ? `the land ${names}` : 'the land';
    const lead = ended
      ? `${land} had seen, as ${mainName(w)} left it`
      : w.state === 'paused'
        ? `${land}${names ? ' have' : ''} seen so far`
        : w.day != null
          ? `${land} had seen by day ${countWord(w.day)}`
          : `${land} had seen`;
    const doing = andList(people.map((p) => pastDoing(p, ended)));
    const when = !doing ? '' : w.state === 'paused' ? ` When it paused, ${doing}.` : ` ${doing}.`;
    const sign = w.state === 'paused' ? ' A card on the glass says back shortly.' : '';
    return `A card model in a gallery window of ${lead}.${when}${sign}`;
  }
  const who = people.length ? `the land ${names} ${people.length === 1 ? 'has' : 'have'} seen so far` : 'the land seen so far';
  const doing = andList(people.map((p) => doingWord(p)));
  return `A card model in a gallery window of ${who}, a layer for every step of height.${doing ? ` ${doing}.` : ''}`;
}

/** Everything the chapter says, from what the poll holds now. `built`: the model has arrived. */
export function wildmindPlaceWords(w: WildmindShowcase, built = w.glass != null): WildmindPlaceWords {
  const past = w.state === 'between-lives';
  const one = w.invented === 1;
  const asideOn = w.state === 'live' || w.state === 'resting' || w.state === 'paused' || w.state === 'stale';
  const moving = w.people.filter((p) => p.alive);
  const live = (w.state === 'live' || w.state === 'resting') && built && moving.length > 0;
  const line = dateline(w);
  const summary = modelSummary(w, built);
  const tags: WmTag[] = [];
  if (w.state === 'offline') tags.push(SHEET_TAG);
  else {
    const main = w.people.find((p) => p.id === 'main');
    const mate = w.people.find((p) => p.id === 'companion');
    if (main) tags.push(mainTag(w, main));
    if (mate) tags.push(companionTag(w, mate));
    const latest = latestTag(w);
    if (latest) tags.push(latest);
  }
  return {
    head: {
      kicker: 'Wildmind · a model under glass',
      title: 'It makes things up to stay alive',
      unit: `${one ? 'thing' : 'things'} invented in ${past ? 'that' : 'this'} valley`,
      aside: asideOn ? 'Please don’t tap the glass.' : undefined,
      figure: w.invented,
      dateline: line,
    },
    key: keyText(w),
    rules: rulesText(w),
    captions: live
      ? {
          moving: moving.length > 1 ? 'The two of them move on the model as they do in the valley.' : `${moving[0].name} moves on the model as they do in the valley.`,
          held: 'The model’s holding still where they were.',
          reduced: 'The model jumps to where they are each time it checks.',
        }
      : null,
    close: 'I’ll write up how it all works once it stops surprising me.',
    summary,
    tags,
    print: [...(line ? [{ dt: 'The valley’s clock', dd: line }] : []), { dt: 'In the window', dd: summary }],
  };
}
/* copy:end */

/* -------------------------------------------------------------------- pins */

export interface WmPin {
  x: number;
  y: number;
  lead: number;
  dir: 'up' | 'down' | 'side' | 'plate';
  hang: 'l' | 'r';
  /** No dot at the anchor: the leader is drawn in the scene, from the figure. */
  bare?: boolean;
}

/**
 * Each label's pin: the people on the back wall over their figures
 * (peopleAnchors; with no model to place them yet, either side of the
 * middle), "made up lately" on the plinth's plaque, the offline sheet's
 * label up from the top of the sheet.
 */
export function wildmindPins(tags: WmTag[], anchors: PersonAnchor[]): Array<WmTag & WmPin> {
  const by = new Map(anchors.map((a) => [a.id, a]));
  const V = GALLERY.vitrine;
  return tags.map((t): WmTag & WmPin => {
    if (t.id === 'main' || t.id === 'companion') {
      const a = by.get(t.id) ?? (t.id === 'main' ? { at: 690, hang: 'l' as const } : { at: 730, hang: 'r' as const });
      return { ...t, x: a.at, y: GALLERY.labelY, lead: 0, dir: 'up', hang: a.hang, bare: true };
    }
    // The plaque is centred on the plinth's face, so it stays on it at every width.
    if (t.id === 'latest') return { ...t, x: 710, y: GALLERY.plinth.top + (GALLERY.window.y + GALLERY.window.h - GALLERY.plinth.top) / 2, lead: 0, dir: 'plate', hang: 'r' };
    return { ...t, x: V.x + V.w * 0.7, y: V.back + 6, lead: 30, dir: 'up', hang: 'r' };
  });
}
