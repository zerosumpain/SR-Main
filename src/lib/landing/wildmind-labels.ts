// wildmind-labels.ts — where the words go on a Wildmind map drawn in the
// browser at a measured width (the sentence plate; a later place scene can
// use it too). The frame it works in is wildmind-frame.ts. Pure, so the
// collision rules are unit tests. (The notes view places its words on the
// server for three fixed layouts: notes-map-words.ts.)
//
// Words are never SVG text (a scaled viewBox would take type under the 12px
// floor): a view sets them as HTML over the map, at the positions this returns.
// It works in pixels at the map's drawn width, because the type is a fixed
// pixel size whatever the map's scale.
//
//  - Nothing is set over a disc.
//  - The places someone is near come first (the captions name them, so the
//    map shows where they are), at any width: on their spot, or a line above
//    or below it when a disc is in the way.
//  - Then the people's name tags, always placed: beside each disc, on the
//    right unless that would leave the frame or the disc sits in the
//    right-hand quarter, and on the other side when a near place, or a mark
//    the view asks to keep clear, is in the way and that side is clear.
//  - Then the rest, only on a map wide enough to hold them (600px):
//    landmarks first, then the others spread out (each time, the name
//    farthest from every name and person already set, so every island gets
//    some), at most MAX_PLACES of those. Each is tried on its spot, then a
//    line above and below it, then starting or ending on it. A name near the
//    edge is pulled inside the frame rather than dropped. A name that would
//    touch one already placed, or a mark the view asks to keep clear
//    (`marks`, such as a camp), is left out; a `soft` mark (a lone built
//    thing) is kept clear when any spot allows, and covered rather than lose
//    the name when none does.
//
// The estimates are deliberately generous (a serif italic at 0.52em a
// character, a display face at 0.6em), so a name never runs into its
// neighbour even where the font is wider than measured.

import type { FrameRect } from './wildmind-frame';

/** Map width (px) under which only the places someone is near are named. */
export const PLACE_MIN_WIDTH = 600;
/** The most ordinary (non-landmark) place names on one map. */
export const MAX_PLACES = 13;
/** Type sizes (px) the boxes are estimated at. */
export const TAG_PX = 14;
export const PLACE_PX = 14;
export const LANDMARK_PX = 16;
/** The leader line between a disc and its tag. */
export const LEADER_PX = 14;

type Box = [number, number, number, number];

export interface LabelInput {
  labels: Array<{ name: string; x: number; y: number; landmark: boolean }>;
  frame: FrameRect;
  people: Array<{ id: string; name: string; x: number; y: number; near?: string | null }>;
  /** The map's drawn width in pixels. */
  width: number;
  /** A person's disc radius in pixels. */
  rPx: number;
  /** Boxes in map units ([x0, y0, x1, y1]) no place name may touch: what the view has built on the map. */
  marks?: Array<[number, number, number, number]>;
  /** Boxes in map units a name keeps off when it can, but may cover rather than be left out. */
  soft?: Array<[number, number, number, number]>;
}

export interface PlacedLabels {
  people: Array<{ id: string; side: 'l' | 'r' }>;
  places: Array<{ name: string; x: number; y: number; landmark: boolean }>;
}

const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Name tags and place names for a map, as described at the top of this file. */
export function placeLabels({ labels, frame, people, width, rPx, marks = [], soft = [] }: LabelInput): PlacedLabels {
  const ppu = width / frame.w;
  const height = width * (frame.h / frame.w);
  const px = (x: number, y: number): [number, number] => [(x - frame.x) * ppu, (y - frame.y) * ppu];
  const toPx = ([x0, y0, x1, y1]: Box): Box => [...px(x0, y0), ...px(x1, y1)];
  const taken: Box[] = [];
  const hard = marks.map(toPx);
  const softPx = soft.map(toPx);
  const out: PlacedLabels = { people: [], places: [] };
  const hits = (b: Box, ...lists: Box[][]) => lists.some((list) => list.some((o) => overlaps(b, o)));

  const near = new Set(people.map((p) => p.near).filter((n): n is string => !!n));
  const isNear = (l: { name: string }) => near.has(l.name);

  // The discs first, so nothing is set on top of anyone.
  for (const p of people) {
    const [X, Y] = px(p.x, p.y);
    taken.push([X - rPx - 4, Y - rPx - 4, X + rPx + 4, Y + rPx + 4]);
  }
  const size = (l: { name: string; landmark: boolean }) => {
    const fs = l.landmark ? LANDMARK_PX : PLACE_PX;
    return { hw: (l.name.length * 0.52 * fs) / 2 + 3, hh: (1.25 * fs) / 2 + 3 };
  };
  const boxFor = (l: { name: string; landmark: boolean }, X: number, Y: number): Box => {
    const { hw, hh } = size(l);
    // Pulled inside the frame rather than lost at its edge.
    X = Math.min(Math.max(X, hw), Math.max(hw, width - hw));
    Y = Math.min(Math.max(Y, hh), Math.max(hh, height - hh));
    return [X - hw, Y - hh, X + hw, Y + hh];
  };
  const r = (n: number) => Math.round(n * 100) / 100;
  const set = (l: { name: string; landmark: boolean }, b: Box) => {
    taken.push(b);
    out.places.push({ name: l.name, x: r((b[0] + b[2]) / 2 / ppu + frame.x), y: r((b[1] + b[3]) / 2 / ppu + frame.y), landmark: l.landmark });
  };
  // Where each tag would go if nothing were in its way (right, unless that
  // leaves the frame or the disc is in the right-hand quarter).
  const tagBox = (p: (typeof people)[number], s: 'l' | 'r'): Box => {
    const [X, Y] = px(p.x, p.y);
    const w = p.name.length * 0.6 * TAG_PX + LEADER_PX;
    return s === 'r' ? [X + rPx + 2, Y - 9, X + rPx + 2 + w, Y + 9] : [X - rPx - 2 - w, Y - 9, X - rPx - 2, Y + 9];
  };
  const firstSide = (p: (typeof people)[number]): 'l' | 'r' => {
    const [X] = px(p.x, p.y);
    return X / width > 0.75 || tagBox(p, 'r')[2] > width ? 'l' : 'r';
  };
  const tagsWanted = people.map((p) => tagBox(p, firstSide(p)));
  // The places someone is near: on their spot, or a line above or below it
  // when that spot is under someone's disc. A spot clear of where the tags
  // want to go is preferred (on real maps the person often stands right by
  // the name), so a tag never has to sit over the name it is beside.
  for (const l of labels.filter(isNear)) {
    const [X, Y] = px(l.x, l.y);
    const step = 1.25 * (l.landmark ? LANDMARK_PX : PLACE_PX) + 6;
    const tries = [0, -step, step].map((dy) => boxFor(l, X, Y + dy));
    const b = tries.find((c) => !hits(c, taken, tagsWanted)) ?? tries.find((c) => !hits(c, taken));
    if (b) set(l, b);
  }
  // Then each tag, on its preferred side unless that side is in the way of a
  // name or a mark and the other is free.
  for (const [i, p] of people.entries()) {
    // Everything set so far but this person's own disc, which a tag always touches.
    const others = taken.filter((_, j) => j !== i);
    const right = tagBox(p, 'r');
    const left = tagBox(p, 'l');
    let side = firstSide(p);
    const box = (s: 'l' | 'r') => (s === 'r' ? right : left);
    const other = side === 'r' ? 'l' : 'r';
    const fits = (s: 'l' | 'r') => (s === 'r' ? right[2] <= width : left[0] >= 0);
    if (hits(box(side), others, hard, softPx) && fits(other) && !hits(box(other), others, hard, softPx)) side = other;
    taken.push(box(side));
    out.people.push({ id: p.id, side });
  }
  if (width < PLACE_MIN_WIDTH) return out;

  /** The first clear spot for a name: on it, then above, below, right, left; covering a soft mark only when no spot avoids it. */
  const spot = (l: { name: string; x: number; y: number; landmark: boolean }): Box | undefined => {
    const [X, Y] = px(l.x, l.y);
    const { hw, hh } = size(l);
    const tries: Array<[number, number]> = [
      [0, 0],
      [0, -(2 * hh + 2)],
      [0, 2 * hh + 2],
      // Sideways it still starts (or ends) on its spot, so it never drifts
      // off the land it names into the blank between two islands.
      [hw - 4, 0],
      [-(hw - 4), 0],
    ];
    const boxes = tries.map(([dx, dy]) => boxFor(l, X + dx, Y + dy));
    return boxes.find((b) => !hits(b, taken, hard, softPx)) ?? boxes.find((b) => !hits(b, taken, hard));
  };
  for (const l of labels.filter((x) => x.landmark && !isNear(x))) {
    const b = spot(l);
    if (b) set(l, b);
  }
  // The ordinary names, spread: each time the one farthest from every name
  // and person already set (ties to the map's own order).
  const centre = (b: Box): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const setAt: Array<[number, number]> = [...people.map((p) => px(p.x, p.y)), ...taken.slice(people.length).map(centre)];
  const left = labels.filter((x) => !x.landmark && !isNear(x));
  let ordinary = out.places.filter((l) => !l.landmark).length;
  while (left.length && ordinary < MAX_PLACES) {
    let best = 0;
    let far = -1;
    left.forEach((l, i) => {
      const [X, Y] = px(l.x, l.y);
      const d = setAt.length ? Math.min(...setAt.map(([a, b]) => Math.hypot(X - a, Y - b))) : Infinity;
      if (d > far) [far, best] = [d, i];
    });
    const [l] = left.splice(best, 1);
    const b = spot(l);
    if (!b) continue;
    set(l, b);
    setAt.push(centre(b));
    ordinary++;
  }
  return out;
}
