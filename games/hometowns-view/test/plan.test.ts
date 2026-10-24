// Plan, then Build (spec §9.3): gestures become ops, ghosts have their own
// undo and eraser, and the preview's cost and refusals are exactly the
// engine's (the server applies the same ops with the same code).

import { describe, expect, it } from 'vitest';
import { fixture } from '../../../scripts/hometowns/fixture';
import { CAT_ROAD, COUNTY_ROAD_X, USE_EMPTY, applyCommand, buildable, paramsFor, parcelOpen, planesOf, terrainOf, tileIndex, useCat, type Op, type TownState } from '../src/engine';
import { Plan, gestureOf, opFor, opTiles, previewPlan, rectOf, snapRoad } from '../src/plan/plan';
import { trayItems, TRAYS, unlockReason } from '../src/plan/trays';

describe('gestures', () => {
  it('snaps a dragged road straight, or into an L along the longer side first', () => {
    expect(snapRoad(3, 3, 3, 3)).toEqual([3, 3]);
    expect(snapRoad(3, 3, 9, 3)).toEqual([3, 3, 9, 3]);
    expect(snapRoad(3, 3, 9, 5)).toEqual([3, 3, 9, 3, 9, 5]);
    expect(snapRoad(3, 3, 4, 9)).toEqual([3, 3, 3, 9, 4, 9]);
  });

  it('spans a rectangle from any two corners, clipped to the map', () => {
    expect(rectOf(5, 9, 2, 4)).toEqual([2, 4, 4, 6]);
    expect(rectOf(-3, 60, 2, 70)).toEqual([0, 60, 3, 4]);
  });

  it('makes the op each tool means, centring a building on the finger', () => {
    expect(gestureOf({ kind: 'road' })).toBe('line');
    expect(gestureOf({ kind: 'zone' })).toBe('rect');
    expect(gestureOf({ kind: 'place' })).toBe('tap');
    expect(gestureOf({ kind: 'none' })).toBe('none');
    expect(opFor({ kind: 'zone', variant: 'shops' }, 1, 1, 2, 3)).toEqual({ op: 'zone', zone: 'shops', rect: [1, 1, 2, 3] });
    expect(opFor({ kind: 'place', id: 'park' }, 10, 10, 10, 10)).toEqual({ op: 'place', id: 'park', x: 10, y: 10, rot: 0 });
    expect(opFor({ kind: 'place', id: 'secondarySchool' }, 10, 10, 10, 10)).toEqual({ op: 'place', id: 'secondarySchool', x: 9, y: 9, rot: 0 });
    expect(opFor({ kind: 'place', id: 'nope' }, 1, 1, 1, 1)).toBeNull();
    expect(opFor({ kind: 'parcel' }, 40, 20, 40, 20)).toEqual({ op: 'parcel', p: 6 });
    expect(opTiles({ op: 'place', id: 'park', x: 10, y: 10, rot: 0 })).toEqual([tileIndex(10, 10), tileIndex(11, 10), tileIndex(10, 11), tileIndex(11, 11)]);
  });
});

describe('the ghost list', () => {
  it('adds, erases, undoes and clears ghosts, and holds at most 60', () => {
    const p = new Plan(3, 'test', () => 1);
    const a: Op = { op: 'zone', zone: 'homes', rect: [0, 0, 2, 2] };
    const b: Op = { op: 'road', kind: 'lane', path: [5, 5, 9, 5] };
    expect(p.add(a)).toBe(true);
    expect(p.add(b)).toBe(true);
    expect(p.erase(tileIndex(7, 5))).toBe(1);
    expect(p.ops).toEqual([a]);
    expect(p.undo()).toBe(true);
    expect(p.ops).toEqual([a, b]);
    p.add(a);
    expect(p.add(b)).toBe(false); // full
    const id = p.planId;
    p.clear();
    expect(p.empty).toBe(true);
    expect(p.planId).toBe(id);
    p.undo();
    expect(p.ops).toHaveLength(3);
    p.committed();
    expect(p.empty).toBe(true);
    expect(p.planId).not.toBe(id);
    expect(p.undo()).toBe(false);
  });
});

describe('previewPlan', () => {
  const f = fixture('hamlet');
  const c = f.county;
  const t = c.towns[f.town];
  const env = { params: paramsFor(c.paramsVersion), dayIndex: c.dayIndex, profile: 'adult' as const };
  // A row beside the County Road with seven free, buildable tiles west of it and a free row below.
  const free = (town: TownState, x: number, yy: number) => parcelOpen(town, x, yy) && planesOf(town).use[tileIndex(x, yy)] === USE_EMPTY && buildable(terrainOf(town)[tileIndex(x, yy)]);
  const y = [...Array(30).keys()].map((k) => 16 + k).find((yy) => [1, 2, 3, 4, 5, 6].every((d) => free(t, COUNTY_ROAD_X - d, yy) && free(t, COUNTY_ROAD_X - d, yy + 1)))!;
  const lane: Op = { op: 'road', kind: 'lane', path: [COUNTY_ROAD_X, y, COUNTY_ROAD_X - 6, y] };

  it('charges what the server charges, and leaves the town untouched', () => {
    const before = JSON.stringify(t);
    const p = previewPlan(t, [lane], env);
    expect(JSON.stringify(t)).toBe(before);
    expect(p.refused).toBeNull();
    expect(p.ops[0].ok).toBe(true);
    const server = JSON.parse(JSON.stringify(c));
    const r = applyCommand(server, server.towns[f.town].seat, { type: 'build', planId: 'x1', plan: [lane] }, f.now);
    expect(p.cost).toBe(r.cost);
    expect(p.upkeep).toBeGreaterThan(0);
    for (const i of opTiles(lane)) expect(p.marks.get(i)).toBe('ok');
    expect(useCat(planesOf(server.towns[f.town]).use[tileIndex(COUNTY_ROAD_X - 3, y)])).toBe(CAT_ROAD);
  });

  it('marks zone tiles with no road within two as "no road", and those beside the new lane as fine', () => {
    const far: Op = { op: 'zone', zone: 'homes', rect: [COUNTY_ROAD_X - 6, y - 6, 2, 1] };
    const near: Op = { op: 'zone', zone: 'homes', rect: [COUNTY_ROAD_X - 5, y + 1, 3, 1] };
    const p = previewPlan(t, [lane, far, near], env);
    expect(opTiles(far).every((i) => p.marks.get(i) === 'noRoad' || p.marks.get(i) === 'bad')).toBe(true);
    expect(opTiles(near).some((i) => p.marks.get(i) === 'ok')).toBe(true);
  });

  it('gives the engine’s own sentence for a ghost that cannot be built, and refuses the plan', () => {
    const locked: Op = { op: 'place', id: 'pocketPark', x: 0, y: 0, rot: 0 };
    const p = previewPlan(t, [lane, locked], env);
    expect(p.ops[0].ok).toBe(true);
    expect(p.ops[1].ok).toBe(false);
    expect(p.refused).toMatch(/does not fit/);
    for (const i of opTiles(locked)) expect(p.marks.get(i)).toBe('bad');
  });

  it('draws a coverage ring for a placed building with a radius', () => {
    const p = previewPlan(t, [lane, { op: 'place', id: 'villageGreen', x: COUNTY_ROAD_X - 3, y: y + 1, rot: 0 }], env);
    expect(p.rings).toHaveLength(1);
    expect(p.rings[0].r).toBeGreaterThan(0);
  });
});

describe('the Build menu', () => {
  it('lists every tray, with padlocks and a reason for what a hamlet cannot build', () => {
    const t = fixture('hamlet').county.towns[0];
    const items = trayItems(t);
    for (const tray of TRAYS) expect(items.some((i) => i.tray === tray)).toBe(true);
    const school = items.find((i) => i.label === 'Secondary School');
    expect(school?.locked).toBe(unlockReason(2));
    expect(school?.locked).toMatch(/^Unlocks at Town: 2,000 people$/);
    expect(items.find((i) => i.label === 'Well')?.locked).toBeNull();
    expect(items.find((i) => i.label === 'Town Hall')).toBeUndefined();
  });
});
