// showcase-sentence-wildmind.ts — the sentence view's fifth chapter, Wildmind,
// as words: "It makes things up to stay alive".
//
// Two people with Claude for minds live in a small world on a box in the
// house. The chapter is set like the four before it (numeral, headline, a huge
// figure, side lines, footnoted value words, a margin chart, a second
// movement) with one addition, the map (SsWildmind.svelte), which this module
// captions (the plate's label, the people lines, the scale and the key) and
// whose built marks it gathers into camps.
//
// It reads only the allow-listed public shape (wildmind.ts): counts, enums,
// game time and bounded names. Nothing anyone in the valley thought, said or
// planned is ever read. Time is the valley's own ("day 18"), never a clock
// time. A missing figure is a dash or a missing clause, never a zero.
//
// Imports showcase-sentence and is never imported by it, so the essay's
// module graph has no cycle.

import { countWord } from './sentence';
import {
  NOT_ANSWERING,
  capWord,
  counted,
  joinClauses,
  type ChapterCopy,
  type Marginal,
  type Note,
  type Seg,
  type SideLine,
  type Tone,
  type Visual,
} from './showcase-sentence';
import { MODEL_FALLBACK, type TerrainClass, type Weather, type WildmindMap, type WildmindPerson, type WildmindShowcase } from './wildmind';
import { frameRect } from './wildmind-frame';
import { andList, causeWord, counted as placesWord, daysWord, doingWord, habitWord, mainName, mapSummary, modelsLine, ordinalWord } from './wildmind-words';

const T = (s: string): Seg => ({ t: 'text', s });
const W = (id: string, word: string, note?: Note, tone: Tone = 'accent'): Seg => ({ t: 'word', id, word, tone, note });
/** A name in its person's colour, as the disc on the map: the prose doubles as the key. */
const N = (id: 'main' | 'companion', name: string): Seg => ({ t: 'word', id: `wm-who-${id}`, word: name, tone: id === 'main' ? 'accent' : 'ink' });

/** The weather after "a … day". */
export const WEATHER_ADJ: Record<Weather, string> = {
  clear: 'clear',
  cloudy: 'cloudy',
  rain: 'wet',
  storm: 'stormy',
  snow: 'snowy',
  fog: 'foggy',
};

/** Scale bar lengths and their words. */
export const SCALE_WORDS: ReadonlyArray<[number, string]> = [
  [50, 'fifty metres'],
  [100, 'a hundred metres'],
  [200, 'two hundred metres'],
  [500, 'half a kilometre'],
  [1000, 'a kilometre'],
];

/**
 * The plate's fixed frame: always three by two, and at least PLATE_MIN_METRES
 * across on the ground (so a young valley sits small on the sheet). In
 * metres, not map units: a map traced coarser (two tiles a unit) has half the
 * units for the same ground, and must not be shrunk into the middle.
 */
export const PLATE_ASPECT = 1.5;
export const PLATE_MIN_METRES = 240;
export function plateFrame(map: Pick<WildmindMap, 'metresPerUnit'>): { aspect: number; minW: number } {
  return { aspect: PLATE_ASPECT, minW: PLATE_MIN_METRES / Math.max(0.5, map.metresPerUnit) };
}

/** Two built things this close (metres on the ground) or closer are in the same group. */
export const CAMP_LINK_M = 9;
/** A group of at least this many is drawn as one camp, not as so many squares. */
export const CAMP_MIN = 6;
/** How far a camp's outline stands off the things in it (metres). */
export const CAMP_PAD_M = 4;

export interface BuiltMarks {
  /** Each camp as a closed outline (`M… L… z`, map units), with the things in it (drawn faint inside the fence). */
  camps: Array<{ d: string; count: number; members: Array<{ x: number; y: number; complete: boolean }> }>;
  /** Built things outside a camp. */
  singles: Array<{ x: number; y: number; complete: boolean }>;
  /** Boxes in map units a place name may not touch: round each thing in a camp. */
  clear: Array<[number, number, number, number]>;
  /** Boxes a name keeps off if it can, but may cover rather than be lost: each single. */
  soft: Array<[number, number, number, number]>;
}

/**
 * What they've built, as the plate draws it: a close group of CAMP_MIN or more
 * becomes one camp (a rounded outline round the group, so forty shelters read
 * as a camp and not as forty specks), and anything else stays a small square.
 * `metresPerUnit` is the map's (two when a unit is a tile).
 */
export function builtMarks(structures: WildmindShowcase['structures'], metresPerUnit = 2, min = CAMP_MIN): BuiltMarks {
  const link = CAMP_LINK_M / metresPerUnit;
  const pad = CAMP_PAD_M / metresPerUnit;
  const soft = 2 / metresPerUnit;
  const n = structures.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (Math.hypot(structures[i][0] - structures[j][0], structures[i][1] - structures[j][1]) <= link) parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
  const out: BuiltMarks = { camps: [], singles: [], clear: [], soft: [] };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  for (const g of [...groups.values()].sort((a, b) => a[0] - b[0])) {
    if (g.length >= min) {
      const ring: Array<[number, number]> = [];
      for (const i of g)
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          ring.push([structures[i][0] + Math.cos(a) * pad, structures[i][1] + Math.sin(a) * pad]);
        }
      const hull = convexHull(ring);
      const members = g.map((i) => ({ x: structures[i][0], y: structures[i][1], complete: structures[i][2] === 1 }));
      out.camps.push({ d: `M${hull.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')}z`, count: g.length, members });
      for (const i of g) out.clear.push([structures[i][0] - pad, structures[i][1] - pad, structures[i][0] + pad, structures[i][1] + pad]);
    } else
      for (const i of g) {
        const [x, y, complete] = structures[i];
        out.singles.push({ x, y, complete: complete === 1 });
        out.soft.push([x - soft, y - soft, x + soft, y + soft]);
      }
  }
  return out;
}

/** The convex hull of some points (Andrew's monotone chain), clockwise on screen. */
function convexHull(pts: Array<[number, number]>): Array<[number, number]> {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Array<[number, number]> = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** "reed basket" from "Reed basket" or "Reed Basket": every word lower case but an acronym ("UV"). */
export function sentenceCase(name: string): string {
  return name.replace(/\S+/g, (word) => (/^[A-Z0-9]{2,}$/.test(word.replace(/[^A-Za-z0-9]/g, '')) ? word : word.toLowerCase()));
}

const isLive = (w: WildmindShowcase) => w.state === 'live' || w.state === 'resting';
const sorted = (w: WildmindShowcase) => [...w.people].sort((a, b) => (a.id === b.id ? 0 : a.id === 'main' ? -1 : 1));

/** "thinks with Haiku and invents with Sonnet", only when both models are on the allow-list. */
function modelsSide(w: WildmindShowcase): SideLine[] {
  const m = w.models;
  if (!m || m.mind === MODEL_FALLBACK || m.designer === MODEL_FALLBACK) return [];
  const line = modelsLine(m);
  return line ? [{ text: line }] : [];
}

/** The chapter's live state, as side lines in the margin, then the models. */
export function wildmindSide(w: WildmindShowcase): SideLine[] {
  return w.state === 'offline' ? stateSide(w) : [...stateSide(w), ...modelsSide(w)];
}

function stateSide(w: WildmindShowcase): SideLine[] {
  const day = w.day != null ? `day ${countWord(w.day)}` : null;
  const when = day && w.season ? `${day} · ${w.season}` : day;
  switch (w.state) {
    case 'live':
      return [
        ...(when ? [{ text: when, live: true }] : []),
        ...(w.weather ? [{ text: `a ${WEATHER_ADJ[w.weather]} ${(w.night ?? 0) >= 0.5 ? 'night' : 'day'}` }] : []),
      ];
    case 'resting':
      return [...(when ? [{ text: when, live: true }] : []), { text: 'minds resting till tomorrow' }];
    case 'paused':
      return [...(when ? [{ text: when }] : []), { text: 'paused just now' }];
    case 'between-lives':
      return [{ text: 'between lives' }, { text: 'the next wakes up shortly' }];
    case 'stale':
      // The day is in the prose ("how the valley stood on day 18"); the margin just says why.
      return [{ text: NOT_ANSWERING }];
    default:
      return [{ text: NOT_ANSWERING }];
  }
}

/** The lives before the current one (or the one just ended), oldest first. */
function livesBefore(w: WildmindShowcase) {
  const before = w.state === 'between-lives' ? w.earlierLives.slice(1) : w.earlierLives;
  return [...before].reverse();
}

/** The line as bars, oldest first: every earlier life, then this one (open) unless between lives. At most six. */
export function lifeRows(w: WildmindShowcase): Extract<Visual, { kind: 'lives' }> | null {
  if (w.generation == null) return null;
  const ended = [...w.earlierLives].reverse().map((l) => ({ days: l.days, cause: l.cause, open: false }));
  const open = w.state !== 'between-lives' && w.day != null ? [{ days: w.day, cause: null, open: true }] : [];
  const all = [...ended, ...open];
  const shown = all.slice(-6);
  if (!shown.length) return null;
  const more = Math.max(0, w.generation - shown.length);
  const longest = Math.max(1, ...shown.map((r) => r.days));
  const first = w.generation - shown.length + 1;
  const rows = shown.map((r, i) => {
    const ord = ordinalWord(first + i);
    const cause = causeWord(r.cause);
    return {
      label: r.open ? `${ord} · day ${countWord(w.day ?? 0)} · this one` : [ord, daysWord(r.days), ...(cause ? [cause] : [])].join(' · '),
      share: Math.round((r.days / longest) * 1000) / 1000,
      open: r.open,
    };
  });
  const said = shown.map((r, i) => {
    const ord = ordinalWord(first + i);
    if (r.open) return `this one is on day ${countWord(w.day ?? 0)}`;
    const cause = causeWord(r.cause);
    return `the ${ord} lasted ${daysWord(r.days)}${cause ? ` and died of ${cause}` : ''}`;
  });
  const told = said.length > 1 ? `${said.slice(0, -1).join(', ')}, and ${said[said.length - 1]}` : said[0];
  const summary =
    `${capWord(w.generation)} ${w.generation === 1 ? 'life' : 'lives'} so far.` +
    (more ? ` The ${more === 1 ? 'one' : countWord(more)} before ${more === 1 ? 'is' : 'are'} left off.` : '') +
    ` ${told.charAt(0).toUpperCase()}${told.slice(1)}.`;
  return { kind: 'lives', rows, more, summary };
}

export interface PlateWords {
  label: string;
  who: Array<{ id: 'main' | 'companion'; text: string; hollow: boolean }>;
  /** Map units per grid square (fifty metres, doubled until the sheet holds at most eight). */
  grid: number;
  scale: { metres: number; word: string };
  keys: Array<'wood' | 'wet' | 'water' | 'high' | 'camp' | 'built' | 'animals'>;
}

/** The map is a still, not the valley now: between lives, stale, or paused. */
const isStill = (w: WildmindShowcase) => w.state === 'between-lives' || w.state === 'stale' || w.state === 'paused';

/** What someone was doing when the map was last drawn: "Wren was at work near Bittern Beds". */
function pastDoing(p: WildmindPerson, ended: boolean): string {
  if (!p.alive) return ended ? `${p.name} died` : `${p.name} was dead`;
  return p.near ? `${p.name} was ${p.doing} near ${p.near}` : `${p.name} was ${p.doing}`;
}

/**
 * The map's text equivalent beside the plate: mapSummary while the valley is
 * running, and in the past tense when the map is a still (as JKai left it, as
 * it stood when it stopped answering, or when it paused).
 */
export function plateSummary(w: WildmindShowcase): string {
  if (!isStill(w) || !w.map) return mapSummary(w);
  const names = andList(sorted(w).map((p) => p.name));
  const places = w.map.labels.length;
  const where = places ? `, where ${w.state === 'paused' ? 'they’ve' : 'they’d'} named ${placesWord(places)}` : '';
  const doing = andList(sorted(w).map((p) => pastDoing(p, w.state === 'between-lives')));
  if (w.state === 'paused') return `A map of the land ${names} have seen so far${where}.${doing ? ` When it paused, ${doing}.` : ''}`;
  const lead = w.state === 'between-lives' ? 'had seen, as JKai left it' : w.day != null ? `had seen by day ${countWord(w.day)}` : 'had seen';
  return `A map of the land ${names} ${lead}${where}.${doing ? ` ${doing}.` : ''}`;
}

/** The plate's captions, or null with no map to caption. */
export function plateWords(w: WildmindShowcase): PlateWords | null {
  const m = w.map;
  if (!m) return null;
  const f = frameRect(m, plateFrame(m));
  const label =
    w.state === 'between-lives'
      ? 'The valley · as JKai left it'
      : w.state === 'stale'
        ? 'The valley · as it stood'
        : 'The valley · as they’ve seen it';
  let grid = 50 / m.metresPerUnit;
  while (f.w / grid > 8) grid *= 2;
  const span = 0.2 * f.w * m.metresPerUnit;
  let scale = SCALE_WORDS[0];
  for (const s of SCALE_WORDS) if (Math.abs(s[0] - span) < Math.abs(scale[0] - span)) scale = s;
  const has = (c: TerrainClass) => m.layers.some((l) => l.cls === c);
  const keys: PlateWords['keys'] = [];
  if (has('wood')) keys.push('wood');
  if (has('fresh') || has('sea')) keys.push('water');
  if (has('wet')) keys.push('wet');
  if (has('high')) keys.push('high');
  const marks = builtMarks(w.structures, m.metresPerUnit);
  if (marks.camps.length) keys.push('camp');
  if (marks.singles.length) keys.push('built');
  if (w.animals.length) keys.push('animals');
  const still = isStill(w);
  return {
    label,
    who: sorted(w).map((p) => ({ id: p.id, text: still ? pastDoing(p, w.state === 'between-lives') : doingWord(p), hollow: !isLive(w) || !p.alive })),
    grid,
    scale: { metres: scale[0], word: scale[1] },
    keys,
  };
}

/** "the first lasted 32 days and died of the cold", for each life before this one. */
function lifeClauses(w: WildmindShowcase): Seg[] {
  const gen = w.generation ?? 1;
  const n = gen - 1;
  const before = livesBefore(w);
  if (!n || !before.length) return [];
  if (n >= 4) {
    const days = before.map((l) => l.days);
    return [T(` The ${countWord(n)} before them lasted anything from ${daysWord(Math.min(...days))} to ${daysWord(Math.max(...days))}.`)];
  }
  const first = n - before.length + 1;
  const parts = before.map((l, i) => {
    const cause = causeWord(l.cause);
    return [T(`the ${ordinalWord(first + i)} lasted ${daysWord(l.days)}${cause ? ` and died of ${cause}` : ''}`)];
  });
  const joined = joinClauses(parts, ', and ').map((s) => (s.t === 'text' ? s.s : '')).join('');
  return [T(` ${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`)];
}

const CLOSE = 'I’ll write up how it all works once it stops surprising me.';

/** The chapter, from what the poll holds now. */
export function wildmindChapter(w: WildmindShowcase): ChapterCopy {
  const past = w.state === 'between-lives';
  const hasMap = w.map != null;
  const names = sorted(w);
  const main = mainName(w);

  /* p1: what it is */
  const p1: Seg[] = [T(`I’m also building a little world called Wildmind, where the ${names.length === 2 ? 'two ' : ''}people in it have Claude for a mind. `)];
  if (names.length >= 2) p1.push(N(names[0].id, names[0].name), T(' and '), N(names[1].id, names[1].name), T(' start in a valley with nothing and have to think up anything they want'));
  else if (names.length === 1)
    p1.push(N(names[0].id, names[0].name), T(` starts in a valley with nothing and has to think up anything they want`));
  // Nobody on the map (not answering): no names to give, so none are guessed.
  else p1.push(T('They start in a valley with nothing and have to think up anything they want'));
  p1.push(
    T(', and a stubborn referee in the code throws out any idea the valley couldn’t actually supply. It runs on its own on a box in the house whether anyone’s watching or not'),
  );
  if (hasMap)
    p1.push(
      T(
        past
          ? ', and the map below is the valley as JKai left it.'
          : w.state === 'stale'
            ? ', and the map below is the last one it sent.'
            : ', and the map below is the land they’ve seen so far.',
      ),
    );
  else p1.push(T('.'));

  // The state sentence, in the valley's own time.
  const dayNote: Note = {
    head: 'The valley’s clock',
    text: 'The valley keeps its own time, much faster than ours, so the day, the season and the dark on the map are theirs, not ours.',
    visual: { kind: 'none' },
  };
  const day = () => W('wm-day', `day ${countWord(w.day ?? 0)}`, dayNote);
  if (w.state === 'offline') {
    p1.push(T(' The valley isn’t answering just now, so there’s no map of it.'));
  } else if (w.day != null) {
    if (w.state === 'live') p1.push(T(' It’s '), day(), T(' of this life.'));
    else if (w.state === 'resting') p1.push(T(' It’s '), day(), T(' of this life, and their minds are resting till tomorrow, so they’re getting by on habit.'));
    else if (w.state === 'paused') p1.push(T(' It’s '), day(), T(' of this life, and the valley’s paused just now.'));
    else if (w.state === 'stale') p1.push(T(' This is how the valley stood on '), day(), T(', and it isn’t answering just now.'));
    else {
      const cause = causeWord(w.earlierLives[0]?.cause);
      p1.push(T(' '), N('main', main), T(cause ? ` died of ${cause} on ` : ' died on '), day(), T(', and the next of the line wakes up in a fresh valley shortly.'));
    }
  }

  // The data sentence: places, the latest invention, the referee.
  if (w.state !== 'offline') {
    const clauses: Seg[][] = [];
    // One count of places: with a map, the names on it (and the note lists
    // them); without one, the game's own tally.
    const places = w.map ? w.map.labels.length : w.placesFound;
    if (places) {
      const listed = w.map ? w.map.labels.map((l) => l.name) : [];
      const onMap = w.map != null;
      clauses.push([
        T(onMap ? (past ? 'they’d named ' : 'they’ve named ') : past ? 'they found ' : 'they’ve found '),
        W('wm-places', counted(places, 'place'), {
          head: 'Places · named as they’re seen',
          text: 'Every place gets its name from a list in the game the moment one of them first sets eyes on it.',
          visual: listed.length ? { kind: 'list', items: listed } : { kind: 'none' },
        }),
      ]);
    }
    if (w.invented === 0) clauses.push([T(past ? 'they never made anything up' : 'they haven’t made anything up yet')]);
    else if (w.invented != null && w.latest.length)
      clauses.push([
        T(past ? 'the last thing they made up was ' : 'the latest thing they’ve made up is '),
        W('wm-latest', `the ${sentenceCase(w.latest[0])}`, {
          head: 'Made up lately · newest first',
          text: 'Every tool, shelter and basket starts as an idea from one of them, a second model turns it into a working design, and the count includes the in-between stuff like twine and reed mats.',
          visual: { kind: 'list', items: w.latest },
        }),
      ]);
    if (w.refused === 0) clauses.push([T(past ? 'the referee never turned anything down' : 'the referee hasn’t turned anything down yet')]);
    else if (w.refused != null)
      clauses.push([
        T(past ? 'the referee turned down ' : 'the referee has turned down '),
        W('wm-refused', w.refused === 1 ? 'one idea' : `${countWord(w.refused)} ideas`, {
          head: 'The referee',
          text: 'Every invention is checked against what they’ve actually found and handled before it’s allowed to exist, and anything that leans on something they haven’t got goes back to be thought about again.',
          visual: { kind: 'none' },
        }),
        T(' of theirs'),
      ]);
    if (clauses.length) p1.push(T(past ? ' Between them ' : ' So far '), ...joinClauses(clauses, ', and '), T('.'));
  }

  /* p2: the family tree */
  let p2: ChapterCopy['p2'] = null;
  const lives = lifeRows(w);
  if (w.generation != null) {
    const gen = w.generation;
    const segs: Seg[] = [
      T(past ? `That ${main} was the ` : `This ${main} is the `),
      W('wm-line', ordinalWord(gen), {
        head: `The line · ${counted(gen, 'life', 'lives')}`,
        text: `A bar a life, oldest at the top, as long as the life lasted.${past ? '' : ' The open one at the foot is this one.'}`,
        visual: lives ?? { kind: 'none' },
      }),
      T(gen === 1 && !past ? ' of the line, so nobody’s had to pass anything on yet.' : ' of the line.'),
      ...lifeClauses(w),
    ];
    if (past) segs.push(T(' Claude is reading back over their life now to leave the next one a few lessons, which is roughly how families work too.'));
    else if (gen > 1) segs.push(T(' Each time one dies Claude reads back over the life and leaves the next a few lessons, which is roughly how families work too.'));
    const habit = habitWord(w.habitShare);
    if (habit) {
      const note: Note = {
        head: 'Habit and thought',
        text: 'When one of them meets something new they stop and think, and whatever they work out is kept as a habit for next time, so routine things never wake the model.',
        visual: { kind: 'none' },
      };
      // Only "most" earns "the model only gets woken when something's new".
      // Resting, the thinking part waits (the first movement has just said
      // they're getting by on habit), so nothing "still needs thinking about".
      const resting = w.state === 'resting';
      const rest = past
        ? w.habitShare === 'some'
          ? ' of what they did was habit, though most of it still needed thinking about.'
          : w.habitShare === 'about-half'
            ? ' of what they did was habit, and the rest still needed thinking about.'
            : ' of what they did was habit, so the model only got woken when something was new.'
        : resting
          ? w.habitShare === 'most'
            ? ' of what they do is habit by now, which is as well with their minds resting.'
            : ` of what they do is habit ${w.habitShare === 'some' ? 'already' : 'by now'}, and the rest waits till their minds are back.`
          : w.habitShare === 'some'
            ? ' of what they do is habit already, though most of it still needs thinking about.'
            : w.habitShare === 'about-half'
              ? ' of what they do is habit by now, and the rest still needs thinking about.'
              : ' of what they do is habit by now, so the model only gets woken when something’s new.';
      segs.push(T(' '), W('wm-habit', habit, note), T(rest));
    }
    segs.push(T(` ${CLOSE}`));
    p2 = { sub: 'The family tree', segs };
  } else {
    p1.push(T(` ${CLOSE}`));
  }

  const margin: Marginal | null =
    lives && w.generation != null && w.generation > 1 ? { label: `The line · ${counted(w.generation, 'life', 'lives')}`, visual: lives } : null;
  const one = w.invented === 1;
  return {
    id: 'wildmind',
    nth: 5,
    numeral: 'v.',
    label: 'Wildmind',
    head: 'It makes things up to stay alive',
    tone: 'accent',
    ground: 'paper',
    figure: {
      value: w.invented,
      decimals: 0,
      unit: past ? `${one ? 'thing' : 'things'} invented in that valley` : `${one ? 'thing' : 'things'} invented in this valley`,
      spoken: NOT_ANSWERING,
    },
    side: wildmindSide(w),
    margin,
    p1,
    p2,
  };
}
