// wildmind.ts — the public shape of Wildmind on the landing page, and the pure
// functions that make it: the validator for what Wildmind's public snapshot
// sends (parseSnapshot), the projection to what the browser gets (project),
// and the state the chapter is in (stateOf).
//
// Wildmind is a small world where two people have Claude for minds. Its public
// snapshot is already an allow-list, and this is the second one: every field
// is copied out by hand, unknown keys are dropped, enums are checked against
// fixed lists, numbers against ranges and arrays against caps. Names the model
// made (inventions) and names from the game's fixed lists (places, people) may
// cross, bounded by boundName. Free text never can: no thought, speech, mood,
// plan, description or activity label is read, even when one is sent.
//
// Freshness is game time only ("day N"). The browser never receives a clock
// time from Wildmind, because a home box's outage times would say when the
// house lost power or broadband (see showcase.ts, "nothing that reveals absence").
//
// Client-safe: components import the types from here (type-only), the server
// modules import the functions. The tracer is wildmind-trace.server.ts.

// ── Wire enums (Wildmind's own) ─────────────────────────────────────────────

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const WEATHERS = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'] as const;
export type Weather = (typeof WEATHERS)[number];

export const ACTIVITIES = ['idle', 'walking', 'working', 'sleeping', 'thinking', 'talking', 'eating', 'riding', 'dead'] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const STRUCTURE_CLASSES = ['shelter', 'store', 'fire', 'pen', 'other'] as const;
export type StructureClass = (typeof STRUCTURE_CLASSES)[number];

export const CAUSES = ['starvation', 'thirst', 'cold', 'exhaustion', 'injuries'] as const;
export type Cause = (typeof CAUSES)[number];

export const STATUSES = ['running', 'paused', 'resting', 'between-lives', 'halted'] as const;
export type SnapshotStatus = (typeof STATUSES)[number];

export const MORALES = ['good', 'getting-by', 'low'] as const;
export type Morale = (typeof MORALES)[number];

/** Wildmind's terrain kinds (shared/types.ts TERRAINS), each with the map class it is drawn as. */
export const TERRAIN_CLASS: Record<string, TerrainClass> = {
  deep_sea: 'sea',
  shallow_sea: 'sea',
  deep_fresh: 'fresh',
  shallow_fresh: 'fresh',
  sand: 'shore',
  grass: 'open',
  farmland: 'open',
  path: 'open',
  forest: 'wood',
  jungle: 'wood',
  marsh: 'wet',
  rock: 'high',
  snow: 'high',
  tundra: 'high',
  volcanic: 'high',
};

/** The animals the game has, as words. Anything else is drawn but never named. */
export const SPECIES = ['rabbit', 'deer', 'boar', 'duck', 'wolf', 'goat', 'horse', 'bear', 'fish', 'sheep', 'cow', 'pig', 'chicken'] as const;

/** What an invention is (Wildmind's DefKind). */
export const DEF_KINDS = ['material', 'tool', 'weapon', 'food', 'clothing', 'container', 'structure', 'vehicle', 'medicine', 'ornament'] as const;
export type DefKind = (typeof DEF_KINDS)[number];

// ── Wire shape (v1), as parseSnapshot leaves it ─────────────────────────────

export interface WildmindTerrain {
  origin: [number, number];
  step: number;
  w: number;
  h: number;
  terrains: string[];
  /** base64 bytes, w×h: 0 = unseen, else index into `terrains` + 1. */
  t: string;
  /** base64 bytes, w×h: round((height + 2) × 10), 0 when unseen. */
  height: string;
  regions: Array<{ n: string; k: 'l' | 'r' | 'h'; x: number; z: number }>;
}

export interface WildmindSnapshotPerson {
  id: 'main' | 'companion';
  name: string;
  x: number;
  z: number;
  heading: number;
  /** An unknown value arrives as null and reads as "busy". */
  activity: Activity | null;
  alive: boolean;
  thinking: boolean;
  near: string | null;
  trail: Array<[number, number]>;
  morale: Morale | null;
}

export interface WildmindSnapshotV1 {
  v: 1;
  status: SnapshotStatus;
  terrainVersion: string;
  terrain?: WildmindTerrain;
  time: { day: number; season: Season; dayOfSeason: number; hour: number; daylight: number; weather: Weather; tempC: number };
  people: WildmindSnapshotPerson[];
  species: string[];
  animals: Array<[number, number, number, 0 | 1]>;
  structures: Array<[number, number, 0 | 1, 0 | 1, StructureClass]>;
  fires: Array<[number, number]>;
  stats: {
    generation: number;
    earlierLives: Array<{ days: number; cause: Cause | null }>;
    invented: number;
    latest: Array<{ name: string; kind: DefKind | null; day: number; by: 'main' | 'companion' }>;
    refused: number;
    placesFound: number;
    exploredTiles: number;
    built: Record<StructureClass, number>;
    tamed: number;
    /** `met` is null when the snapshot leaves it out, so a missing field never claims they haven't met. */
    milestones: { met: boolean | null; partners: boolean; shelter: boolean; fire: boolean; store: boolean; pen: boolean };
    choices: { thought: number; habit: number };
    models: { mind: string; designer: string };
  };
}

// ── Public shape (what the browser gets) ────────────────────────────────────

export type WildmindState = 'live' | 'resting' | 'paused' | 'between-lives' | 'stale' | 'offline';
export type TerrainClass = 'sea' | 'fresh' | 'shore' | 'open' | 'wood' | 'wet' | 'high';
export const TERRAIN_CLASSES: readonly TerrainClass[] = ['sea', 'fresh', 'shore', 'open', 'wood', 'wet', 'high'];

/** The traced map: `viewBox="0 0 w h"`, one unit per map cell, y down (Wildmind's z). */
export interface WildmindMap {
  version: string;
  w: number;
  h: number;
  /** Metres one map unit spans (a tile is two metres), for a scale bar. */
  metresPerUnit: number;
  /** Everything seen, as one ring set: the ground under the classes, and the edge of the known. */
  seen: string;
  /** One even-odd path per class present, in TERRAIN_CLASSES order. */
  layers: Array<{ cls: TerrainClass; d: string }>;
  /** High ground (one height band), for a hatch or a contour. Null when there is none. */
  relief: string | null;
  /** Places with their centre seen, landmarks first. Drawn as HTML, never SVG text. */
  labels: Array<{ name: string; x: number; y: number; landmark: boolean }>;
  /**
   * True when the paths are the notes view's pencilled ones (notes-sheet.server.ts)
   * rather than the tracer's staircase: only the notes view draws these, and
   * any other view asks for the map again.
   */
  pencil?: true;
}

export interface WildmindPerson {
  id: 'main' | 'companion';
  name: string;
  /** Map units. */
  x: number;
  y: number;
  /** Radians; the facing direction on the map is (sin h, cos h). */
  heading: number;
  /** A fixed word from DOING: "asleep", "at work", "busy". */
  doing: string;
  alive: boolean;
  thinking: boolean;
  near: string | null;
  /** Recent positions, oldest first, in map units (empty after a Wildmind restart). */
  trail: Array<[number, number]>;
}

export interface WildmindShowcase {
  state: WildmindState;
  day: number | null;
  season: Season | null;
  weather: Weather | null;
  /** 0 (day) to 1 (full night), for the wash. */
  night: number | null;
  /** Null on a ?have= hit (the client keeps its own) and before any map. */
  map: WildmindMap | null;
  mapVersion: string | null;
  people: WildmindPerson[];
  /** Species words the animals index into (SPECIES only; others become "animal"). */
  species: string[];
  /** [x, y, species index, tame] in map units. */
  animals: Array<[number, number, number, 0 | 1]>;
  /** [x, y, complete, lit, class] in map units. */
  structures: Array<[number, number, 0 | 1, 0 | 1, StructureClass]>;
  fires: Array<[number, number]>;
  invented: number | null;
  /** The latest invention names, newest first, at most three. */
  latest: string[];
  refused: number | null;
  placesFound: number | null;
  exploredTiles: number | null;
  generation: number | null;
  /** Newest first. */
  earlierLives: Array<{ days: number; cause: Cause | null }>;
  habitShare: 'most' | 'about-half' | 'some' | null;
  /** Display names ("Haiku"), or "a Claude model". */
  models: { mind: string; designer: string } | null;
  /**
   * Whether the two have met, or null when it is not known (an older
   * snapshot, offline). Optional: absent reads as null, never as "not yet".
   */
  met?: boolean | null;
  /**
   * The rest of the notes view's drawing, worked out on the server
   * (notes-sheet.server.ts), so the page carries none of the pencilling or
   * word-placing code. Only when the notes view asked for it (the SSR of
   * that view, or its poll with ?view=notes); `map` is then the pencilled map.
   */
  notes?: WildmindNotesSheet | null;
}

/** The notes view's map, ready to draw (with the pencilled `map` beside it). */
export interface WildmindNotesSheet {
  /** Where the tags, the "haven't met" note and the place names go in each layout, for this answer's people. */
  words: import('./notes-map-words').MapWords | null;
  /** Every camp's fence, as one path in map units. */
  camp: string;
  /** How many camps, and how many huts stand on their own (for the key). */
  camps: number;
  huts: number;
  /** Marks are drawn this many map units a design unit (notes-map-pencil.ts markScale). */
  mark: number;
}

// ── Words ───────────────────────────────────────────────────────────────────

/** What someone is doing, as a fixed British word. */
export const DOING: Record<Activity, string> = {
  idle: 'standing about',
  walking: 'walking',
  working: 'at work',
  sleeping: 'asleep',
  thinking: 'thinking it over',
  talking: 'talking',
  eating: 'eating',
  riding: 'riding',
  dead: 'dead',
};
export const DOING_UNKNOWN = 'busy';

/** What someone died of: "died of {word}". */
export const CAUSE: Record<Cause, string> = {
  starvation: 'hunger',
  thirst: 'thirst',
  cold: 'the cold',
  exhaustion: 'exhaustion',
  injuries: 'their injuries',
};

/** Model ids to display names. Anything else is "a Claude model". */
export const MODEL_NAMES: Record<string, string> = {
  'claude-haiku-5-5': 'Haiku',
  'claude-sonnet-5-5': 'Sonnet',
  'claude-opus-5-5': 'Opus',
  'claude-haiku-4-5': 'Haiku',
  'claude-sonnet-4-5': 'Sonnet',
  'claude-opus-4-5': 'Opus',
};
export const MODEL_FALLBACK = 'a Claude model';

export function modelName(id: string): string {
  return Object.hasOwn(MODEL_NAMES, id) ? MODEL_NAMES[id] : MODEL_FALLBACK;
}

// ── Bounds ──────────────────────────────────────────────────────────────────

/**
 * The same deny list as Wildmind's own (server/public.ts), for tone and layout
 * rather than privacy: names are approved for publishing. Whole words only, so
 * "Grape press", "Flint scraper" and "Scunthorpe" pass; a few roots are matched
 * inside words too. NAME_DENY_CASES in wildmind.test.ts mirrors public-check.ts.
 */
const DENY_WORDS = new Set([
  'arse', 'ass', 'bastard', 'bitch', 'bollocks', 'boob', 'boobs', 'chink', 'cock', 'coon', 'crap', 'cum', 'dick', 'dildo', 'dyke',
  'fag', 'heil', 'hitler', 'jizz', 'kike', 'nazi', 'paki', 'penis', 'piss', 'porn', 'prick', 'pussy', 'rape', 'rapist', 'retard', 'retards', 'retarded',
  'sex', 'slut', 'spastic', 'spaz', 'tit', 'tits', 'tranny', 'twat', 'vagina', 'wank', 'wanker', 'whore',
]);
const DENY_INSIDE = /fuck|(?<!s)cunt|shit(?!ake)|nigg|fagg/;
const NAME_CHARS = /^[A-Za-z' -]+$/;
const SLUG = /^[a-z_]{1,40}$/;

/** On the deny list: a root anywhere, or a listed word on its own (words split at spaces, apostrophes, hyphens, underscores). */
export function deniedName(s: string): boolean {
  const lower = s.toLowerCase();
  return DENY_INSIDE.test(lower) || lower.split(/[ '_-]+/).some((w) => DENY_WORDS.has(w));
}

/**
 * A name fit to print: letters, apostrophes, spaces and hyphens only, at most
 * forty characters and five words, nothing on the deny list. A name that fails
 * falls back to its slug with spaces (when one is given and is itself clean),
 * otherwise null. No digits, so no name can smuggle a figure or a link.
 */
export function boundName(raw: unknown, slug?: unknown): string | null {
  if (typeof raw === 'string') {
    const s = raw.replace(/\s+/g, ' ').trim();
    const words = s.split(' ').filter(Boolean);
    if (s && NAME_CHARS.test(s) && /[A-Za-z]/.test(s) && s.length <= 40 && words.length <= 5 && !deniedName(s)) return s;
  }
  if (typeof slug === 'string' && SLUG.test(slug) && !deniedName(slug)) {
    const s = slug.replace(/_+/g, ' ').trim();
    if (s && s.split(' ').length <= 5) return s;
  }
  return null;
}

// ── Validator ───────────────────────────────────────────────────────────────

/** Caps on every list the snapshot carries; a list over its cap fails the whole read. */
export const CAPS = {
  terrains: 32,
  regions: 400,
  people: 4,
  trail: 12,
  species: 32,
  animals: 600,
  structures: 1000,
  fires: 600,
  earlierLives: 12,
  latest: 3,
  grid: 256,
} as const;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
const int = (v: unknown, lo: number, hi: number): number | undefined => {
  const n = num(v, lo, hi);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
};
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | undefined =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : undefined;
const bit = (v: unknown): 0 | 1 | undefined => (v === 0 || v === 1 ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const list = (v: unknown, cap: number): unknown[] | undefined => (Array.isArray(v) && v.length <= cap ? v : undefined);
const COORD = 70_000;
const COUNT = 1e9;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const VERSION = /^[A-Za-z0-9._:-]{1,64}$/;

/** Signals a field that failed; caught once at the top. */
class Bad extends Error {}
function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Bad(what);
  return v;
}

/** The byte length of a base64 string, without decoding it. */
function b64Length(s: string): number {
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return (s.length / 4) * 3 - pad;
}

function parseTerrain(raw: unknown): WildmindTerrain {
  const t = need(isObj(raw) ? raw : undefined, 'terrain');
  const origin = need(list(t.origin, 2), 'terrain.origin');
  const w = need(int(t.w, 1, CAPS.grid), 'terrain.w');
  const h = need(int(t.h, 1, CAPS.grid), 'terrain.h');
  const grid = (v: unknown, what: string) => {
    const s = need(typeof v === 'string' && v.length % 4 === 0 && B64.test(v) ? v : undefined, what);
    if (b64Length(s) !== w * h) throw new Bad(what);
    return s;
  };
  const terrains = need(list(t.terrains, CAPS.terrains), 'terrain.terrains').map((n) =>
    need(typeof n === 'string' && /^[a-z_]{1,24}$/.test(n) ? n : undefined, 'terrain.terrains[]'),
  );
  const regions = need(list(t.regions, CAPS.regions), 'terrain.regions').flatMap((r) => {
    const o = need(isObj(r) ? r : undefined, 'region');
    const name = boundName(o.n);
    if (!name) return [];
    return [
      {
        n: name,
        k: need(oneOf(['l', 'r', 'h'] as const, o.k), 'region.k'),
        x: need(num(o.x, -COORD, COORD), 'region.x'),
        z: need(num(o.z, -COORD, COORD), 'region.z'),
      },
    ];
  });
  return {
    origin: [need(int(origin[0], -COORD, COORD), 'origin.x'), need(int(origin[1], -COORD, COORD), 'origin.z')],
    step: need(int(t.step, 1, 64), 'terrain.step'),
    w,
    h,
    terrains,
    t: grid(t.t, 'terrain.t'),
    height: grid(t.height, 'terrain.height'),
    regions,
  };
}

function parsePerson(raw: unknown): WildmindSnapshotPerson {
  const p = need(isObj(raw) ? raw : undefined, 'person');
  const id = need(oneOf(['main', 'companion'] as const, p.id), 'person.id');
  const trail = need(list(p.trail ?? [], CAPS.trail), 'person.trail').map((pt) => {
    const a = need(list(pt, 2), 'trail point');
    return [need(num(a[0], -COORD, COORD), 'trail.x'), need(num(a[1], -COORD, COORD), 'trail.z')] as [number, number];
  });
  return {
    id,
    name: boundName(p.name) ?? (id === 'main' ? 'JKai' : 'their companion'),
    x: need(num(p.x, -COORD, COORD), 'person.x'),
    z: need(num(p.z, -COORD, COORD), 'person.z'),
    heading: need(num(p.heading, -100, 100), 'person.heading'),
    activity: oneOf(ACTIVITIES, p.activity) ?? null,
    alive: need(bool(p.alive), 'person.alive'),
    thinking: bool(p.thinking) ?? false,
    near: p.near == null ? null : boundName(p.near),
    trail,
    morale: oneOf(MORALES, p.morale) ?? null,
  };
}

function parseStats(raw: unknown): WildmindSnapshotV1['stats'] {
  const s = need(isObj(raw) ? raw : undefined, 'stats');
  const built = isObj(s.built) ? s.built : {};
  const ms = isObj(s.milestones) ? s.milestones : {};
  const choices = need(isObj(s.choices) ? s.choices : undefined, 'stats.choices');
  const models = isObj(s.models) ? s.models : {};
  const model = (v: unknown) => (typeof v === 'string' && v.length <= 64 ? v : '');
  return {
    generation: need(int(s.generation, 1, 1_000_000), 'stats.generation'),
    earlierLives: need(list(s.earlierLives, CAPS.earlierLives), 'stats.earlierLives').map((l) => {
      const o = need(isObj(l) ? l : undefined, 'life');
      return { days: Math.round(need(num(o.days, 0, 1_000_000), 'life.days') * 10) / 10, cause: oneOf(CAUSES, o.cause) ?? null };
    }),
    invented: need(int(s.invented, 0, COUNT), 'stats.invented'),
    latest: need(list(s.latest, CAPS.latest), 'stats.latest').flatMap((l) => {
      const o = need(isObj(l) ? l : undefined, 'latest');
      const name = boundName(o.name);
      if (!name) return [];
      return [{ name, kind: oneOf(DEF_KINDS, o.kind) ?? null, day: need(int(o.day, 0, 1_000_000), 'latest.day'), by: oneOf(['main', 'companion'] as const, o.by) ?? 'main' }];
    }),
    refused: need(int(s.refused, 0, COUNT), 'stats.refused'),
    placesFound: need(int(s.placesFound, 0, COUNT), 'stats.placesFound'),
    exploredTiles: need(int(s.exploredTiles, 0, COUNT), 'stats.exploredTiles'),
    built: Object.fromEntries(STRUCTURE_CLASSES.map((c) => [c, int(built[c], 0, COUNT) ?? 0])) as Record<StructureClass, number>,
    tamed: int(s.tamed, 0, COUNT) ?? 0,
    milestones: {
      met: bool(ms.met) ?? null,
      partners: bool(ms.partners) ?? false,
      shelter: bool(ms.shelter) ?? false,
      fire: bool(ms.fire) ?? false,
      store: bool(ms.store) ?? false,
      pen: bool(ms.pen) ?? false,
    },
    choices: { thought: need(int(choices.thought, 0, COUNT), 'choices.thought'), habit: need(int(choices.habit, 0, COUNT), 'choices.habit') },
    models: { mind: model(models.mind), designer: model(models.designer) },
  };
}

/**
 * A Wildmind public snapshot, checked field by field and copied into a fresh
 * object, or null when it is not one. Unknown keys anywhere are dropped;
 * unknown activities, causes and structure classes degrade to null / "other"
 * so a newer Wildmind still draws; a wrong version, status, season or weather,
 * a number out of range or a list over its cap fails the whole read (the memo
 * then keeps the last good one).
 */
export function parseSnapshot(raw: unknown): WildmindSnapshotV1 | null {
  try {
    const o = need(isObj(raw) ? raw : undefined, 'snapshot');
    if (o.v !== 1) throw new Bad('v');
    const time = need(isObj(o.time) ? o.time : undefined, 'time');
    const species = need(list(o.species, CAPS.species), 'species').map((s) =>
      need(typeof s === 'string' && /^[a-z_]{1,24}$/.test(s) ? s : undefined, 'species[]'),
    );
    const snap: WildmindSnapshotV1 = {
      v: 1,
      status: need(oneOf(STATUSES, o.status), 'status'),
      terrainVersion: need(typeof o.terrainVersion === 'string' && VERSION.test(o.terrainVersion) ? o.terrainVersion : undefined, 'terrainVersion'),
      time: {
        day: need(int(time.day, 0, 1_000_000), 'time.day'),
        season: need(oneOf(SEASONS, time.season), 'time.season'),
        dayOfSeason: int(time.dayOfSeason, 0, 1000) ?? 0,
        hour: num(time.hour, 0, 24) ?? 0,
        daylight: need(num(time.daylight, 0, 1), 'time.daylight'),
        weather: need(oneOf(WEATHERS, time.weather), 'time.weather'),
        tempC: num(time.tempC, -80, 80) ?? 0,
      },
      people: need(list(o.people, CAPS.people), 'people').map(parsePerson),
      species,
      animals: need(list(o.animals, CAPS.animals), 'animals').map((r) => {
        const a = need(list(r, 4), 'animal');
        return [
          need(int(a[0], 0, Math.max(0, species.length - 1)), 'animal.species'),
          need(num(a[1], -COORD, COORD), 'animal.x'),
          need(num(a[2], -COORD, COORD), 'animal.z'),
          bit(a[3]) ?? 0,
        ] as [number, number, number, 0 | 1];
      }),
      structures: need(list(o.structures, CAPS.structures), 'structures').map((r) => {
        const a = need(list(r, 5), 'structure');
        return [
          need(num(a[0], -COORD, COORD), 'structure.x'),
          need(num(a[1], -COORD, COORD), 'structure.z'),
          need(bit(a[2]), 'structure.complete'),
          need(bit(a[3]), 'structure.lit'),
          oneOf(STRUCTURE_CLASSES, a[4]) ?? 'other',
        ] as [number, number, 0 | 1, 0 | 1, StructureClass];
      }),
      fires: need(list(o.fires, CAPS.fires), 'fires').map((r) => {
        const a = need(list(r, 2), 'fire');
        return [need(num(a[0], -COORD, COORD), 'fire.x'), need(num(a[1], -COORD, COORD), 'fire.z')] as [number, number];
      }),
      stats: parseStats(o.stats),
    };
    if (o.terrain !== undefined) snap.terrain = parseTerrain(o.terrain);
    return snap;
  } catch (err) {
    if (err instanceof Bad) return null;
    throw err;
  }
}

// ── State ───────────────────────────────────────────────────────────────────

/** A last good read older than this is stale. */
export const STALE_MS = 120_000;
/** A last good read older than this is no longer shown at all. */
export const OFFLINE_MS = 24 * 3_600_000;

/** The chapter's state from Wildmind's status and the age of the last good read (null: never read). */
export function stateOf(status: SnapshotStatus | null, fetchedAt: number | null, now: number): WildmindState {
  if (status === null || fetchedAt === null) return 'offline';
  const age = now - fetchedAt;
  if (age > OFFLINE_MS) return 'offline';
  if (age > STALE_MS) return 'stale';
  switch (status) {
    case 'running':
      return 'live';
    case 'resting':
      return 'resting';
    case 'between-lives':
      return 'between-lives';
    default:
      return 'paused';
  }
}

/** Most of their choices made by habit, about half, or some. Null with no choices yet. */
export function habitShare(choices: { thought: number; habit: number } | null | undefined): WildmindShowcase['habitShare'] {
  if (!choices) return null;
  const total = choices.thought + choices.habit;
  if (!(total > 0)) return null;
  const share = choices.habit / total;
  return share > 0.6 ? 'most' : share >= 0.4 ? 'about-half' : 'some';
}

/** The honest answer when Wildmind has not answered: every figure null (a dash), no map. */
export function offlineShowcase(): WildmindShowcase {
  return {
    state: 'offline',
    day: null,
    season: null,
    weather: null,
    night: null,
    map: null,
    mapVersion: null,
    people: [],
    species: [],
    animals: [],
    structures: [],
    fires: [],
    invented: null,
    latest: [],
    refused: null,
    placesFound: null,
    exploredTiles: null,
    generation: null,
    earlierLives: [],
    habitShare: null,
    models: null,
    met: null,
  };
}

/** Where the traced map sits in the world: world (x, z) to map units. */
export interface MapFrame {
  x0: number;
  z0: number;
  /** World tiles per map unit. */
  per: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** World tile coordinates to map units (a tile's centre is its integer coordinate). */
export function toMap(frame: MapFrame, x: number, z: number): [number, number] {
  return [r2((x - frame.x0 + 0.5) / frame.per), r2((z - frame.z0 + 0.5) / frame.per)];
}

/**
 * A checked snapshot to what the browser gets. `traced` is the map for the
 * snapshot's terrain version (from the tracer), or null when there is none.
 * Positions become map units; anything off the map is left out.
 */
export function project(
  snap: WildmindSnapshotV1,
  fetchedAt: number,
  now: number,
  traced: { map: WildmindMap; frame: MapFrame } | null,
): WildmindShowcase {
  const state = stateOf(snap.status, fetchedAt, now);
  if (state === 'offline') return offlineShowcase();
  const map = traced?.map ?? null;
  const frame = traced?.frame ?? null;
  const on = ([x, y]: [number, number]) => !!map && x >= 0 && y >= 0 && x <= map.w && y <= map.h;
  const at = (x: number, z: number): [number, number] | null => {
    if (!frame) return null;
    const p = toMap(frame, x, z);
    return on(p) ? p : null;
  };
  const species = snap.species.map((s) => ((SPECIES as readonly string[]).includes(s) ? s : 'animal'));

  const people: WildmindPerson[] = [];
  for (const p of snap.people) {
    const pos = at(p.x, p.z);
    if (!pos) continue;
    people.push({
      id: p.id,
      name: p.name,
      x: pos[0],
      y: pos[1],
      heading: r2(p.heading),
      doing: p.alive ? (p.activity ? DOING[p.activity] : DOING_UNKNOWN) : DOING.dead,
      alive: p.alive,
      thinking: p.thinking,
      near: p.near,
      trail: p.trail.flatMap(([x, z]) => {
        const t = at(x, z);
        return t ? [t] : [];
      }),
    });
  }
  const s = snap.stats;
  return {
    state,
    day: snap.time.day,
    season: snap.time.season,
    weather: snap.time.weather,
    night: r2(1 - snap.time.daylight),
    map,
    mapVersion: map ? map.version : null,
    people,
    species,
    animals: snap.animals.flatMap(([i, x, z, tame]) => {
      const p = at(x, z);
      return p ? [[p[0], p[1], i, tame] as [number, number, number, 0 | 1]] : [];
    }),
    structures: snap.structures.flatMap(([x, z, complete, lit, cls]) => {
      const p = at(x, z);
      return p ? [[p[0], p[1], complete, lit, cls] as [number, number, 0 | 1, 0 | 1, StructureClass]] : [];
    }),
    fires: snap.fires.flatMap(([x, z]) => {
      const p = at(x, z);
      return p ? [p] : [];
    }),
    invented: s.invented,
    latest: s.latest.map((l) => l.name).slice(0, CAPS.latest),
    refused: s.refused,
    placesFound: s.placesFound,
    exploredTiles: s.exploredTiles,
    generation: s.generation,
    earlierLives: s.earlierLives.map((l) => ({ days: l.days, cause: l.cause })),
    habitShare: habitShare(s.choices),
    models: { mind: modelName(s.models.mind), designer: modelName(s.models.designer) },
    met: s.milestones.met,
  };
}
