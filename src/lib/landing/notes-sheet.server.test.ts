import { beforeEach, describe, expect, it } from 'vitest';
import recorded from './fixtures/wildmind-day16.json';
import { forNotes, notesSheet, resetNotesSheet } from './notes-sheet.server';
import { offlineShowcase, parseSnapshot, project } from './wildmind';
import { traceGrid } from './wildmind-trace.server';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const snap = parseSnapshot(recorded)!;
const live = () => project(snap, NOW, NOW, traceGrid(snap.terrain!, snap.terrainVersion));

beforeEach(() => resetNotesSheet());

describe('forNotes', () => {
  it('sends the map pencilled and marked so, with the words, camps and mark size beside it', () => {
    const w = live();
    const n = forNotes(w);
    expect(n.map?.pencil).toBe(true);
    expect(n.map?.version).toBe(w.map!.version);
    expect(n.map?.labels).toEqual(w.map!.labels);
    // Pencilled: smooth curves, no staircase, and open ground left to the paper.
    expect(n.map?.seen).toMatch(/q/);
    expect(n.map?.layers.some((l) => l.cls === 'open')).toBe(false);
    expect(n.notes?.words?.places.length).toBeGreaterThan(0);
    for (const p of w.people) expect(n.notes?.words?.tags[p.id]).toBeTruthy();
    expect(n.notes?.camp).toMatch(/^M.*z$/);
    expect(n.notes!.camps + n.notes!.huts).toBeGreaterThan(0);
    // The day-16 map is the one the marks were drawn for.
    expect(n.notes?.mark).toBeCloseTo(1, 2);
  });

  it('leaves an answer with no map alone, and never pencils twice', () => {
    expect(forNotes(offlineShowcase())).toMatchObject({ map: null, notes: null });
    const once = forNotes(live());
    expect(notesSheet(once)).toBeNull();
  });

  it('works an answer out once, and keeps last time’s names when the people move a little', () => {
    const w = live();
    const a = notesSheet(w)!;
    expect(notesSheet(live())).toBe(a);
    const moved = { ...w, people: w.people.map((p) => ({ ...p, x: p.x + 0.4 })) };
    const b = notesSheet(moved)!;
    expect(b).not.toBe(a);
    // Last time's names are preferred: the ones that still fit stay (one may give way to a tag that moved onto it).
    const names = (s: typeof a) => s.sheet.words!.places.map((l) => l.name);
    const kept = names(b).filter((n) => names(a).includes(n));
    expect(kept.length).toBeGreaterThanOrEqual(names(a).length - 1);
    expect(names(b).every((n) => names(a).includes(n))).toBe(true);
  });

  it('draws the marks smaller on a coarser map, so they are the same size on the page', () => {
    const w = live();
    const coarse = { ...w, map: { ...w.map!, version: 'coarse', w: Math.round(w.map!.w / 2), h: Math.round(w.map!.h / 2), metresPerUnit: 4 } };
    expect(notesSheet(coarse)!.sheet.mark).toBeLessThan(0.6);
  });
});
