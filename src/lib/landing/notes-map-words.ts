// notes-map-words.ts — the notes view's Wildmind map, its words: where the
// people's tags, the "haven't met" note and the place names go, for each of
// the three layouts the page can be in (wide, narrow and phone, the phone
// one turned a quarter when the map is wide). It works in pixels at the
// smallest width each layout covers, because the type is a fixed size
// whatever the map's scale: a set that fits there fits everywhere wider.
//
// Pure. It runs on the server (notes-sheet.server.ts) once per answer the
// page gets; the page is sent the result (MapWords), never this code.

import type { WildmindMap, WildmindPerson } from "./wildmind";
import type { Pt } from "./notes-ink";
import {
  LAYOUT_KEYS,
  layoutsFor,
  mapPx,
  markScale,
  ringsOf,
  type Layout,
  type LayoutKey,
} from "./notes-map-pencil";
/* ---------------------------------------------------------------- words */

type Box = [number, number, number, number];
const hits = (a: Box, b: Box) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const inside = (b: Box, W: number, H: number, m: number) =>
  b[0] >= m && b[1] >= m && b[2] <= W - m && b[3] <= H - m;
const around = (X: number, Y: number, r: number): Box => [
  X - r,
  Y - r,
  X + r,
  Y + r,
];

/** Margin kept clear inside the map's box (px). */
export const EDGE = 8;
/** Room round each person's disc (px either way). */
export const DISC = 12;
/** A tag's text sits this far out from its disc (px), past a 44×30 pen arrow. */
export const TAG_DX = 46;
export const TAG_DY = 26;
export const TAG_H = 24;
/** A tag straight over or under its disc sits closer, as it has no arrow. */
export const TAG_DY_STRAIGHT = 12;
/** The gap between a place's cross and its name (px). */
export const PLACE_GAP = 7;
/** Above or below the cross, the name sits this far off it (px). */
export const PLACE_GAP_Y = 5;
/** The paper patch each word is written on: this much either side of the type (px). */
export const PATCH = 4;
/** A cross's reach either way (px): another word never covers it. */
export const CROSS = 5;
/** Type width estimates (em a character): generous, so a name never meets its neighbour. */
const TAG_EM = 0.52;
const PLACE_EM = 0.56;
const NOTE_EM = 0.5;
/** The corners the moon (top right) and the stamp (bottom right) take (px). */
const MOON: [number, number] = [84, 66];
const STAMP: [number, number] = [160, 34];
/** A hut drawn on its own, and an animal, in map units either way at markScale 1 (the hut as the page draws it, scaled down). */
const HUT = 0.5;
const ANIMAL = 0.5;
/** A hut in a camp: room round it, so a word keeps off the fence too (CAMP_PAD in notes-map-marks.ts, and a little). */
const CAMP_HUT = 2.4;

/** Words for "they haven't met yet": shown only when they are farther apart than this (metres). */
export const MET_APART_M = 60;
export const MET_NOTE = "they haven’t met yet";

export type Side = { sx: 1 | 0 | -1; sy: 1 | -1 };
/** Up-right, up-left, down-right, down-left, then straight up or down (a narrow map): the order a tag tries its sides in. */
export const SIDES: readonly Side[] = [
  { sx: 1, sy: -1 },
  { sx: -1, sy: -1 },
  { sx: 1, sy: 1 },
  { sx: -1, sy: 1 },
  { sx: 0, sy: -1 },
  { sx: 0, sy: 1 },
];

/** Where a place's name goes from its cross: right, left, above, below; 0 is not written. */
export type PlaceDir = 1 | -1 | 2 | -2;
const DIRS: readonly PlaceDir[] = [1, -1, 2, -2];

export interface WordsInput {
  map: Pick<WildmindMap, "w" | "h" | "labels"> &
    Partial<Pick<WildmindMap, "seen" | "metresPerUnit">>;
  people: Array<
    Pick<WildmindPerson, "id" | "x" | "y" | "alive" | "near"> & { tag: string }
  >;
  met: boolean | null | undefined;
  /** What is drawn on the map that words must keep off (map units): huts on their own, huts in camps, animals. */
  marks?: {
    huts?: Array<[number, number]>;
    camped?: Array<[number, number]>;
    animals?: Array<[number, number]>;
  };
  /** Names written last time: kept where they still fit, so a small move does not swap them for others. */
  prefer?: readonly string[];
}

export interface MapWords {
  /** Each person's tag side per layout. */
  tags: Record<string, Record<LayoutKey, Side>>;
  /** The met note's place per layout, as fractions of the map, or null where it does not fit; null when it is not said anywhere. */
  met: Record<LayoutKey, { x: number; y: number } | null> | null;
  /** Place names written in at least one layout: x, y as fractions of the map, and where the name goes per layout (0 not written). */
  places: Array<{
    name: string;
    x: number;
    y: number;
    at: Record<LayoutKey, PlaceDir | 0>;
    /** Per layout, where the name is written by a person's disc (their point as fractions) rather than its cross. */
    bare?: Record<LayoutKey, { x: number; y: number } | null>;
  }>;
}

/** A tag's text box (with its paper patch) and its arrow's box, from the disc at X, Y. */
export function tagBoxes(
  X: number,
  Y: number,
  s: Side,
  chars: number,
  px: number,
): [Box, Box] {
  const tw = chars * TAG_EM * px;
  const span = (from: number, to: number, sign: number): [number, number] =>
    sign > 0 ? [from, to] : [-to, -from];
  if (s.sx === 0) {
    // Straight over or under the disc, with no arrow (the words sit right by it).
    const [ty0, ty1] = span(TAG_DY_STRAIGHT, TAG_DY_STRAIGHT + TAG_H, s.sy);
    const [ay0, ay1] = span(2, TAG_DY_STRAIGHT, s.sy);
    return [
      [X - tw / 2 - PATCH, Y + ty0, X + tw / 2 + PATCH, Y + ty1],
      [X - 2, Y + ay0, X + 2, Y + ay1],
    ];
  }
  const [tx0, tx1] = span(TAG_DX - PATCH, TAG_DX + tw + PATCH, s.sx);
  const [ty0, ty1] = span(TAG_DY, TAG_DY + TAG_H, s.sy);
  const [ax0, ax1] = span(2, TAG_DX, s.sx);
  const [ay0, ay1] = span(2, TAG_DY + 6, s.sy);
  return [
    [X + tx0, Y + ty0, X + tx1, Y + ty1],
    [X + ax0, Y + ay0, X + ax1, Y + ay1],
  ];
}

/** Beside a person instead of a cross (the place they're standing on): the patch starts this far from the disc's centre (px). */
export const BARE_GAP = DISC + 2;

/**
 * A place name's box (with its paper patch) by its cross at X, Y: right (1),
 * left (−1), above (2) or below (−2). `bare`: by the disc of the person
 * standing there instead, a disc's width off, with no cross.
 */
export function placeBox(
  X: number,
  Y: number,
  dir: PlaceDir,
  chars: number,
  px: number,
  bare = false,
): Box {
  const tw = chars * PLACE_EM * px + 2 * PATCH;
  const th = 1.3 * px;
  const gx = bare ? BARE_GAP : PLACE_GAP - PATCH;
  const gy = bare ? BARE_GAP : PLACE_GAP_Y;
  if (dir === 1) return [X + gx, Y - th / 2, X + gx + tw, Y + th / 2];
  if (dir === -1) return [X - gx - tw, Y - th / 2, X - gx, Y + th / 2];
  if (dir === 2) return [X - tw / 2, Y - gy - th, X + tw / 2, Y - gy];
  return [X - tw / 2, Y + gy, X + tw / 2, Y + gy + th];
}

/** Where the met note may go: shares of the way from one person to the other, and nudges a rule up or down. */
const MET_ALONG = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74] as const;
const MET_NUDGE = [0, -32, 32, -64, 64] as const;

/** Whether a point lies on seen land (even-odd over the traced `seen` rings). The rings are memoised per path. */
const ringMemo = new Map<string, Pt[][]>();
export function seenAt(seen: string, x: number, y: number): boolean {
  let rings = ringMemo.get(seen);
  if (!rings) {
    rings = ringsOf(seen);
    ringMemo.set(seen, rings);
    while (ringMemo.size > 2)
      ringMemo.delete(ringMemo.keys().next().value as string);
  }
  let on = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        on = !on;
    }
  return on;
}

/** Whether a box (px) lies wholly on paper they have not seen, sampled every few pixels and a cell's grace round the land. */
function onPaper(box: Box, geo: Geo, seen: string): boolean {
  const pad = geo.s;
  for (
    let x = box[0] - pad;
    x <= box[2] + pad + 0.01;
    x += Math.max(4, (box[2] - box[0] + 2 * pad) / 12)
  )
    for (
      let y = box[1] - pad;
      y <= box[3] + pad + 0.01;
      y += Math.max(4, (box[3] - box[1] + 2 * pad) / 4)
    ) {
      const [mx, my] = geo.back(x, y);
      if (seenAt(seen, mx, my)) return false;
    }
  return true;
}

/**
 * One layout's words for a given choice of tag sides, in pixels: the tags,
 * then the meeting note, then the place names (the places the people are
 * near, then those written last time, then landmarks, then the rest in the
 * map's order), each skipped where it would leave the map or cover something
 * already there: a word, a person, a hut or a camp, a cross. Animals wander,
 * so they keep off a new name but never unseat one already written.
 *
 * A name is also kept from crowding (crowdOf): within a name's height of
 * another word it would read as one line of a list, and its cross within a
 * name's height of another word could belong to either. A crowded name is
 * left out, unless it is a place someone is near, which goes on its least
 * crowded side; a name is never set flush over or under another name.
 */
function placeWith(input: WordsInput, lay: Layout, geo: Geo, choice: number[]) {
  const { map, people } = input;
  const { W, H, at, s } = geo;
  const pt = ([x, y]: [number, number], r: number) => {
    const [X, Y] = at(x, y);
    return around(X, Y, r);
  };
  const discs = people.map((p) => pt([p.x, p.y], DISC));
  // The marks are drawn markScale times their size in map units (a coarser map, smaller), so they are the same on the page.
  const k = s * markScale(map);
  const marks: Box[] = [
    ...(input.marks?.huts ?? []).map((h) => pt(h, Math.max(2.5, HUT * k))),
    ...(input.marks?.camped ?? []).map((h) => pt(h, CAMP_HUT * k)),
  ];
  const animals = (input.marks?.animals ?? []).map((a) =>
    pt(a, Math.max(2, ANIMAL * k)),
  );
  // Words, people and the corner marks: nothing is written over these. Huts and camps: only the near places' names may be.
  const taken: Box[] = [
    [W - MOON[0], 0, W, MOON[1]],
    [W - STAMP[0], H - STAMP[1], W, H],
    ...discs,
  ];
  // The words written so far (tags, the note, names) and the crosses, for crowding.
  const said: Array<{ b: Box; place: boolean }> = [];
  const crosses: Box[] = [];
  let spill = 0;
  let cover = 0;
  let wander = 0;
  let crowded = 0;
  const over = (b: Box) =>
    Math.max(0, EDGE - b[0]) +
    Math.max(0, EDGE - b[1]) +
    Math.max(0, b[2] - W + EDGE) +
    Math.max(0, b[3] - H + EDGE);
  people.forEach((p, i) => {
    const [X, Y] = at(p.x, p.y);
    const [text, arrow] = tagBoxes(
      X,
      Y,
      SIDES[choice[i]],
      p.tag.length,
      lay.tagPx,
    );
    spill += over(text) + over(arrow);
    // Covering a word, a person or a hut costs the same; an animal counts for less than writing the near place.
    for (const o of taken)
      if (o !== discs[i] && (hits(text, o) || hits(arrow, o))) cover++;
    for (const o of marks) if (hits(text, o)) cover++;
    for (const o of animals) if (hits(text, o)) wander++;
    taken.push(text, arrow);
    said.push({ b: text, place: false });
  });

  let met: [number, number] | null = null;
  const [a, b] = people;
  if (
    input.met === false &&
    a &&
    b &&
    a.alive &&
    b.alive &&
    Math.hypot(a.x - b.x, a.y - b.y) * (map.metresPerUnit ?? 2) > MET_APART_M &&
    map.seen
  ) {
    const hw = (MET_NOTE.length * NOTE_EM * lay.tagPx) / 2 + PATCH;
    const [AX, AY] = at(a.x, a.y);
    const [BX, BY] = at(b.x, b.y);
    search: for (const t of MET_ALONG)
      for (const dy of MET_NUDGE) {
        const X = AX + (BX - AX) * t;
        const Y = AY + (BY - AY) * t + dy;
        const box: Box = [X - hw, Y - TAG_H / 2, X + hw, Y + TAG_H / 2];
        const clear = ![...taken, ...marks, ...animals].some((o) =>
          hits(box, o),
        );
        if (inside(box, W, H, EDGE) && clear && onPaper(box, geo, map.seen)) {
          met = [X, Y];
          taken.push(box);
          said.push({ b: box, place: false });
          break search;
        }
      }
  }

  const near = new Set(
    people
      .filter((p) => p.alive)
      .map((p) => p.near)
      .filter(Boolean),
  );
  const prefer = new Set(input.prefer ?? []);
  const rank = (l: WildmindMap["labels"][number]) =>
    near.has(l.name) ? 0 : prefer.has(l.name) ? 1 : l.landmark ? 2 : 3;
  const order = map.labels
    .map((l, i) => [l, i] as const)
    .sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1])
    .map(([l]) => l);
  const places = new Map<string, PlaceDir>();
  /** Names written by a person's disc instead of a cross, with that person's point (map units). */
  const crossless = new Map<string, [number, number]>();
  let landmarks = 0;
  let nearby = 0;
  let kept = 0;
  for (const l of order) {
    if (places.size >= lay.max) break;
    if (places.has(l.name)) continue;
    const own = near.has(l.name);
    const soft = own || prefer.has(l.name);
    // A cross or a name over a hut or a camp only for the place someone is near (the caption names it, and they're
    // usually near their own camp); nothing is ever written over another word or a person.
    const blocks = (b: Box) =>
      taken.some((o) => hits(b, o)) ||
      (!own && marks.some((o) => hits(b, o))) ||
      (!soft && animals.some((o) => hits(b, o)));
    // Where the name can go: by its cross; for a place someone is near, failing that, by their disc with no cross
    // (they're standing on it, and the cross would sit under them).
    const [X, Y] = at(l.x, l.y);
    const tries: Array<{ X: number; Y: number; bare: boolean }> = [
      { X, Y, bare: false },
    ];
    for (const p of people)
      if (own && p.alive && p.near === l.name)
        tries.push({ X: at(p.x, p.y)[0], Y: at(p.x, p.y)[1], bare: true });
    // The first uncrowded spot wins; failing one, a near place takes its least crowded.
    let pick: { t: (typeof tries)[number]; dir: PlaceDir; box: Box; cross: Box; c: number } | null = null;
    search: for (const t of tries) {
      const cross = around(t.X, t.Y, t.bare ? 0 : CROSS);
      if (!t.bare && blocks(cross)) continue;
      for (const dir of DIRS) {
        const box = placeBox(t.X, t.Y, dir, l.name.length, lay.placePx, t.bare);
        if (!inside(box, W, H, EDGE) || blocks(box)) continue;
        const c = crowdOf(box, t.bare ? null : cross, said, crosses, lay.placePx);
        if (!pick || c < pick.c) pick = { t, dir, box, cross, c };
        if (c === 0) break search;
      }
    }
    if (pick && (pick.c === 0 || own)) {
      const { t, dir, box, cross } = pick;
      places.set(l.name, dir);
      if (t.bare) crossless.set(l.name, geo.back(t.X, t.Y));
      taken.push(box, ...(t.bare ? [] : [cross]));
      said.push({ b: box, place: true });
      if (!t.bare) crosses.push(cross);
      if (pick.c > 0) crowded += Number.isFinite(pick.c) ? pick.c : 10;
      if (own) nearby++;
      else if (prefer.has(l.name)) kept++;
      if (l.landmark) landmarks++;
    }
  }
  // Better first: every tag inside, covering least, the near places written, the note said, names kept, landmarks, names, the preferred sides.
  const score = [
    -Math.round(spill),
    -cover,
    nearby,
    -crowded,
    -wander,
    met !== null ? 1 : 0,
    kept,
    landmarks,
    places.size,
    -choice.reduce((t, c) => t + c, 0),
  ];
  return {
    sides: choice.map((c) => SIDES[c]),
    met,
    places,
    crossless,
    score,
    taken,
  };
}

/**
 * How crowded a place name would be (0 is clear): one for each word within a
 * name's height of it (above, below or beside), each other cross that close
 * to it, and each word that close to its own cross. Infinity when it would
 * sit flush over or under another name, which reads as a list.
 */
export function crowdOf(
  box: Box,
  cross: Box | null,
  said: ReadonlyArray<{ b: Box; place: boolean }>,
  crosses: readonly Box[],
  px: number,
): number {
  const th = 1.3 * px;
  const gaps = (a: Box, o: Box) => [
    Math.max(o[0] - a[2], a[0] - o[2]),
    Math.max(o[1] - a[3], a[1] - o[3]),
  ];
  const close = (a: Box, o: Box) => {
    const [gx, gy] = gaps(a, o);
    return gx < th && gy < th;
  };
  let n = 0;
  for (const w of said) {
    const [gx, gy] = gaps(box, w.b);
    if (w.place && gx < 0 && gy < th) return Infinity;
    if (close(box, w.b)) n++;
    if (cross && close(cross, w.b)) n++;
  }
  for (const c of crosses) if (close(box, c)) n++;
  return n;
}

interface Geo {
  W: number;
  H: number;
  /** Pixels a map unit. */
  s: number;
  at: (x: number, y: number) => [number, number];
  /** A pixel of the words layer back to map units. */
  back: (X: number, Y: number) => [number, number];
}

/** The words layer's size (px) and where a map point falls on it, in a layout. */
export function geometry(map: Pick<WildmindMap, "w" | "h">, lay: Layout): Geo {
  const { mw, mh } = mapPx(map, lay.body, lay.phone, lay.turned);
  const s = mw / map.w;
  return {
    W: lay.turned ? mh : mw,
    H: lay.turned ? mw : mh,
    s,
    at: (x, y) => (lay.turned ? [(map.h - y) * s, x * s] : [x * s, y * s]),
    back: (X, Y) => (lay.turned ? [Y / s, map.h - X / s] : [X / s, Y / s]),
  };
}

const better = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/**
 * One layout's words: every choice of tag sides is tried (six each, so at
 * most thirty-six) and the one that keeps the tags inside, covers least and
 * writes the most that matters wins, ties going to the earlier sides.
 */
export function layoutWords(input: WordsInput, lay: Layout) {
  const geo = geometry(input.map, lay);
  const n = input.people.length;
  let best: ReturnType<typeof placeWith> | null = null;
  for (let k = 0; k < SIDES.length ** n; k++) {
    const choice = Array.from(
      { length: n },
      (_, i) => Math.floor(k / SIDES.length ** i) % SIDES.length,
    );
    const r = placeWith(input, lay, geo, choice);
    if (!best || better(r.score, best.score)) best = r;
  }
  const out = best ?? placeWith(input, lay, geo, []);
  return {
    ...out,
    sides: Object.fromEntries(
      input.people.map((p, i) => [p.id, out.sides[i]]),
    ) as Record<string, Side>,
    W: geo.W,
    H: geo.H,
    geo,
  };
}

/** Where every word on the map goes, in all three layouts. */
export function mapWords(input: WordsInput): MapWords {
  const lays = layoutsFor(input.map);
  const per = lays.map((l) => layoutWords(input, l));
  const pick = <T>(f: (r: (typeof per)[number]) => T) =>
    Object.fromEntries(lays.map((l, i) => [l.key, f(per[i])])) as Record<
      LayoutKey,
      T
    >;

  const tags: MapWords["tags"] = {};
  for (const p of input.people) tags[p.id] = pick((r) => r.sides[p.id]);

  const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
  const metAt = pick((r) => {
    if (!r.met) return null;
    const [x, y] = r.geo.back(r.met[0], r.met[1]);
    return { x: r4(x / input.map.w), y: r4(y / input.map.h) };
  });
  const met = LAYOUT_KEYS.some((k) => metAt[k] !== null) ? metAt : null;

  const places = input.map.labels
    .filter((l) => per.some((r) => r.places.has(l.name)))
    .map((l) => {
      const bare = pick((r) => {
        const p = r.crossless.get(l.name);
        return p
          ? { x: r4(p[0] / input.map.w), y: r4(p[1] / input.map.h) }
          : null;
      });
      return {
        name: l.name,
        x: r4(l.x / input.map.w),
        y: r4(l.y / input.map.h),
        at: pick((r) => r.places.get(l.name) ?? 0),
        ...(LAYOUT_KEYS.some((k) => bare[k]) ? { bare } : {}),
      };
    });
  return { tags, met, places };
}

