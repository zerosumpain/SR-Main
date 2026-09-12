import { describe, expect, it } from 'vitest';
import { captureEvents, ownershipTimeline } from './ownership';
import { regionHistory } from './history';
import { tileKeyOf } from './tiles';

const d = (iso: string) => new Date(iso);
const cells = [
  { x: 10, y: 10 },
  { x: 11, y: 10 },
  { x: 12, y: 10 },
];
const keys = new Set(cells.map((c) => tileKeyOf(c.x, c.y)));

describe('ownershipTimeline', () => {
  it('records a first claim as a flip from nobody', () => {
    const flips = ownershipTimeline(captureEvents('john', cells, d('2026-08-01T10:00:00Z')), d('2026-09-01T00:00:00Z'));
    expect(flips).toHaveLength(3);
    expect(flips[0]).toMatchObject({ from: null, to: 'john', day: '2026-08-01' });
  });
  it('records a handover when a fresher denser claim out-scores an older one', () => {
    const events = [
      ...captureEvents('john', cells, d('2026-07-01T10:00:00Z')),
      ...captureEvents('katie', cells.slice(0, 1), d('2026-08-20T10:00:00Z')),
    ];
    const flips = ownershipTimeline(events, d('2026-09-01T00:00:00Z'));
    const katie = flips.filter((f) => f.to === 'katie');
    expect(katie).toHaveLength(1);
    expect(katie[0]).toMatchObject({ from: 'john', key: tileKeyOf(10, 10), day: '2026-08-20' });
  });
  it('is bounded by now', () => {
    const events = captureEvents('john', cells, d('2026-08-01T10:00:00Z'));
    expect(ownershipTimeline(events, d('2026-07-01T00:00:00Z'))).toEqual([]);
  });
  it('does not flip on a repeat visit by the same owner', () => {
    const events = [
      ...captureEvents('john', cells, d('2026-08-01T10:00:00Z')),
      ...captureEvents('john', cells, d('2026-08-05T10:00:00Z')),
    ];
    expect(ownershipTimeline(events, d('2026-09-01T00:00:00Z'))).toHaveLength(3);
  });
});

describe('regionHistory', () => {
  const now = d('2026-09-01T00:00:00Z');
  const events = [
    ...captureEvents('john', cells, d('2026-07-01T10:00:00Z'), 'loop'),
    ...captureEvents('katie', cells.slice(0, 2), d('2026-08-20T10:00:00Z'), 'loop'),
    ...captureEvents('rory', [{ x: 99, y: 99 }], d('2026-08-21T10:00:00Z'), 'trample'), // outside the region
  ];
  const h = regionHistory(events, keys, now);

  it('ignores events outside the cell set', () => {
    expect(h.battle.find((b) => b.subject === 'rory')).toBeUndefined();
  });
  it('has one timeline point per flip day plus the horizon', () => {
    expect(h.timeline.map((p) => p.day)).toEqual(['2026-07-01', '2026-08-20', '2026-09-01']);
    expect(h.timeline[0].cells).toEqual({ john: 3 });
    expect(h.timeline[1].cells).toEqual({ john: 1, katie: 2 });
    expect(h.timeline[2].cells).toEqual({ john: 1, katie: 2 });
  });
  it('aggregates flips per day per pair', () => {
    expect(h.flips).toEqual([
      { day: '2026-07-01', from: null, to: 'john', cells: 3 },
      { day: '2026-08-20', from: 'john', to: 'katie', cells: 2 },
    ]);
    expect(h.handovers).toBe(2);
  });
  it('fills the battle rows', () => {
    const john = h.battle.find((b) => b.subject === 'john')!;
    const katie = h.battle.find((b) => b.subject === 'katie')!;
    expect(john).toMatchObject({ events: 3, loops: 3, tramples: 0, fills: 0, activeDays: 1, cellsNow: 1, cellsPeak: 3, took: 0, lost: 2 });
    expect(katie).toMatchObject({ events: 2, loops: 2, activeDays: 1, cellsNow: 2, cellsPeak: 2, took: 2, lost: 0 });
    expect(john.firstAt).toBe('2026-07-01T10:00:00.000Z');
    // Sorted by cells held now, descending.
    expect(h.battle[0].subject).toBe('katie');
  });
  it('returns an empty history for a region with no events', () => {
    expect(regionHistory([], keys, now)).toEqual({ timeline: [], flips: [], battle: [], handovers: 0 });
  });
});
