// notes-sheet.server.ts — the notes view's Wildmind map, worked out on the
// server: the ground pencilled (notes-map-pencil.ts), the huts gathered into
// camps (notes-map-marks.ts) and the words placed for all three layouts
// (notes-map-words.ts). The page is sent the result and draws it; none of
// that code goes to the browser, which keeps the notes view's chunk small
// (the notes are the landing page's default view).
//
// The names written last time are kept here, per process, and preferred next
// time, so a small move does not swap them for others. Every reader of the
// page sees the same answer from the memo, so one "last time" serves them all.

import { camps, campPath } from './notes-map-marks';
import { markScale, pencilMap } from './notes-map-pencil';
import { mapWords } from './notes-map-words';
import { isPast, tagWords } from './showcase-notes-wildmind';
import type { WildmindMap, WildmindNotesSheet, WildmindShowcase } from './wildmind';

let last: string[] = [];
const memo = new Map<string, { map: WildmindMap; sheet: WildmindNotesSheet }>();

/**
 * The answer as the notes view draws it: the map pencilled (and marked so),
 * and the sheet beside it. Unchanged when there is no map.
 */
export function forNotes(w: WildmindShowcase): WildmindShowcase {
  const drawn = notesSheet(w);
  return drawn ? { ...w, map: drawn.map, notes: drawn.sheet } : { ...w, notes: null };
}

/** The pencilled map and the sheet for a projected answer that still carries its traced map; null with no map. */
export function notesSheet(w: WildmindShowcase): { map: WildmindMap; sheet: WildmindNotesSheet } | null {
  const map = w.map;
  if (!map || map.pencil) return null;
  const past = isPast(w);
  const key = JSON.stringify([
    map.version,
    past,
    w.met ?? null,
    w.people.map((p) => [p.id, p.x, p.y, p.alive, p.near, p.doing]),
    w.structures.map(([x, y]) => [x, y]),
    w.animals.map(([x, y]) => [x, y]),
  ]);
  const hit = memo.get(key);
  if (hit) return hit;

  const mark = markScale(map);
  const grouped = camps(w.structures, map.metresPerUnit);
  const words = mapWords({
    map,
    people: w.people.map((p) => ({ ...p, tag: tagWords(p, past).all })),
    met: w.met,
    marks: {
      huts: grouped.huts.map(([x, y]) => [x, y]),
      camped: grouped.camps.flat(),
      animals: w.animals.map(([x, y]) => [x, y]),
    },
    prefer: last,
  });
  last = words.places.map((l) => l.name);
  const out = {
    map: { ...pencilMap(map), pencil: true as const },
    sheet: {
      words,
      camp: grouped.camps.map((c, i) => campPath(c, 701 + i * 13, mark)).join(''),
      camps: grouped.camps.length,
      huts: grouped.huts.length,
      mark,
    },
  };
  memo.set(key, out);
  while (memo.size > 4) memo.delete(memo.keys().next().value as string);
  return out;
}

/** Forget what was written last (tests only). */
export function resetNotesSheet(): void {
  last = [];
  memo.clear();
}
