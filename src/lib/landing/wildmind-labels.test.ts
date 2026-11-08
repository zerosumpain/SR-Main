import { describe, expect, it } from 'vitest';
import { frameRect } from './wildmind-frame';
import { LANDMARK_PX, MAX_PLACES, PLACE_PX, placeLabels, type LabelInput } from './wildmind-labels';
import { wildmindFixture } from './wildmind.fixture';

const FRAME = { aspect: 1.5, minW: 120 };
const map = { w: 141, h: 93 };
const frame = frameRect(map, FRAME);

/** The box placeLabels estimates for a place name at `width` px, for the overlap check. */
function placeBox(l: { name: string; x: number; y: number; landmark: boolean }, width: number) {
  const ppu = width / frame.w;
  const fs = l.landmark ? LANDMARK_PX : PLACE_PX;
  const hw = (l.name.length * 0.52 * fs) / 2 + 3;
  const hh = (1.25 * fs) / 2 + 3;
  const X = (l.x - frame.x) * ppu;
  const Y = (l.y - frame.y) * ppu;
  return [X - hw, Y - hh, X + hw, Y + hh];
}

const input = (over: Partial<LabelInput> = {}): LabelInput => ({
  labels: [],
  frame,
  people: [],
  width: 909,
  rPx: 5,
  ...over,
});

describe('frameRect', () => {
  it('pads a map evenly to three by two, at least the minimum wide, with a margin round it', () => {
    // A margin of four per cent of the width (5.64 units) on every side, then three by two.
    expect(frame.w).toBeCloseTo(156.42);
    expect(frame.h).toBeCloseTo(104.28);
    expect(frame.x).toBeCloseTo(-7.71);
    expect(frame.y).toBeCloseTo(-5.64);
    expect(frame.x).toBeLessThan(-5);
    const tiny = frameRect({ w: 20, h: 12 }, FRAME);
    expect(tiny).toEqual({ x: -50, y: -34, w: 120, h: 80 });
    const tall = frameRect({ w: 40, h: 100 }, FRAME);
    expect(tall.w / tall.h).toBeCloseTo(1.5);
    expect(tall.h).toBe(106);
    expect(frameRect(map)).toEqual({ x: 0, y: 0, w: 141, h: 93 });
  });
});

describe('placeLabels', () => {
  it('always places every person, flipping left past three quarters', () => {
    const r = placeLabels(
      input({
        people: [
          { id: 'main', name: 'JKai', x: 40, y: 40 },
          { id: 'companion', name: 'Wren', x: 120, y: 50 },
        ],
      }),
    );
    expect(r.people).toEqual([
      { id: 'main', side: 'r' },
      { id: 'companion', side: 'l' },
    ]);
  });

  it('flips a tag that would run off the right-hand edge', () => {
    const r = placeLabels(input({ width: 300, people: [{ id: 'main', name: 'Someone Longnamed', x: 95, y: 40 }] }));
    expect(r.people[0].side).toBe('l');
  });

  it('names only the places someone is near on a narrow map', () => {
    const labels = [
      { name: 'Mirror Mere', x: 60, y: 40, landmark: true },
      { name: 'Tusker Wood', x: 30, y: 20, landmark: false },
    ];
    expect(placeLabels(input({ width: 318, labels })).places).toEqual([]);
    const r = placeLabels(input({ width: 318, labels, people: [{ id: 'main', name: 'JKai', x: 100, y: 60, near: 'Tusker Wood' }] }));
    expect(r.places.map((p) => p.name)).toEqual(['Tusker Wood']);
  });

  it('names the places someone is near before the landmarks', () => {
    const r = placeLabels(
      input({
        labels: [
          { name: 'Mirror Mere', x: 60, y: 40, landmark: true },
          { name: 'Near Thing', x: 60.5, y: 40.2, landmark: false },
        ],
        people: [{ id: 'main', name: 'JKai', x: 10, y: 10, near: 'Near Thing' }],
      }),
    );
    // The near place keeps its spot; the landmark moves off it.
    expect(r.places.map((p) => p.name)).toEqual(['Near Thing', 'Mirror Mere']);
    expect(r.places[0]).toMatchObject({ x: 60.5, y: 40.2 });
    expect(r.places[1].y).not.toBe(40);
  });

  it('names both near places on the real valley at every width, clear of the people', () => {
    const w = wildmindFixture(Date.parse('2026-10-10T13:30:00Z'));
    const f = frameRect(w.map!, FRAME);
    const near = w.people.map((p) => p.near).filter(Boolean);
    expect(near.length).toBe(2);
    for (const width of [310, 358, 600, 909, 1200]) {
      const r = placeLabels({ labels: w.map!.labels, frame: f, people: w.people, width, rPx: 5 });
      expect(r.places.map((p) => p.name)).toEqual(expect.arrayContaining(near));
      const ppu = width / f.w;
      for (const p of w.people)
        for (const l of r.places) {
          const X = (p.x - f.x) * ppu;
          const Y = (p.y - f.y) * ppu;
          const b = placeBox(l, width);
          // placeBox measures against the shared test frame, which is this frame.
          expect(X > b[0] - 5 && X < b[2] + 5 && Y > b[1] - 5 && Y < b[3] + 5, `${l.name} over ${p.name} at ${width}`).toBe(false);
        }
    }
  });

  it('keeps names off the marks the view asks it to keep clear, moving a name off its spot first', () => {
    const labels = [{ name: 'Wolf Crag', x: 60, y: 40, landmark: false }];
    expect(placeLabels(input({ labels })).places).toEqual([{ name: 'Wolf Crag', x: 60, y: 40, landmark: false }]);
    // A mark on the spot: the name moves just above it.
    const moved = placeLabels(input({ labels, marks: [[59, 39, 61, 41]] })).places;
    expect(moved).toHaveLength(1);
    expect(moved[0].y).toBeLessThan(40);
    // Hemmed in on every side by hard marks: left out.
    expect(placeLabels(input({ labels, marks: [[30, 20, 90, 60]] })).places).toEqual([]);
    // Hemmed in by a soft mark (a lone built thing): covered rather than lost.
    expect(placeLabels(input({ labels, soft: [[30, 20, 90, 60]] })).places).toHaveLength(1);
  });

  it('turns a tag away from a built mark', () => {
    const people = [{ id: 'main', name: 'JKai', x: 60, y: 40 }];
    expect(placeLabels(input({ people })).people[0].side).toBe('r');
    expect(placeLabels(input({ people, soft: [[64, 39.5, 65, 40.5]] })).people[0].side).toBe('l');
  });

  it('spreads the ordinary names, so a far island gets one before a crowded corner fills up', () => {
    const crowd = Array.from({ length: 14 }, (_, i) => ({ name: `Crowd ${String.fromCharCode(65 + i)}`, x: 10 + (i % 4) * 14, y: 10 + Math.floor(i / 4) * 12, landmark: false }));
    const far = { name: 'Zed Island', x: 135, y: 80, landmark: false };
    const r = placeLabels(input({ labels: [...crowd, far] }));
    expect(r.places.map((p) => p.name)).toContain('Zed Island');
    expect(r.places.length).toBeLessThanOrEqual(MAX_PLACES);
  });

  it('pulls a name at the edge inside the frame rather than dropping it', () => {
    const r = placeLabels(input({ labels: [{ name: 'Wolf Crag', x: 140.5, y: 50, landmark: false }] }));
    expect(r.places).toHaveLength(1);
    const [x0, , x1] = placeBox(r.places[0], 909);
    expect(x0).toBeGreaterThanOrEqual(-0.1);
    expect(x1).toBeLessThanOrEqual(909.1);
  });

  it('sets landmarks first, and moves a name that would touch one already placed', () => {
    const r = placeLabels(
      input({
        labels: [
          { name: 'Near Thing', x: 60.5, y: 40.2, landmark: false },
          { name: 'Mirror Mere', x: 60, y: 40, landmark: true },
        ],
      }),
    );
    expect(r.places.map((p) => p.name)).toEqual(['Mirror Mere', 'Near Thing']);
    expect(r.places[0]).toMatchObject({ x: 60, y: 40 });
    const [a, b] = r.places.map((p) => placeBox(p, 909));
    expect(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]).toBe(false);
  });

  it('keeps clear of the people', () => {
    const r = placeLabels(input({ people: [{ id: 'main', name: 'JKai', x: 60, y: 40 }], labels: [{ name: 'Under Him', x: 60, y: 40, landmark: false }] }));
    expect(r.places).toHaveLength(1);
    expect(r.places[0].y).not.toBe(40);
  });

  it('sets at most MAX_PLACES ordinary names, with no two boxes overlapping, on the real valley', () => {
    const w = wildmindFixture(Date.parse('2026-10-10T13:30:00Z'));
    const f = frameRect(w.map!, FRAME);
    for (const width of [600, 667, 888, 909]) {
      const r = placeLabels({ labels: w.map!.labels, frame: f, people: w.people, width, rPx: 5 });
      expect(r.people).toHaveLength(w.people.length);
      expect(r.places.filter((p) => !p.landmark).length).toBeLessThanOrEqual(MAX_PLACES);
      expect(r.places.length).toBeGreaterThan(5);
      const boxes = r.places.map((p) => placeBox(p, width));
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const [a, b] = [boxes[i], boxes[j]];
          expect(a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1], `${r.places[i].name} / ${r.places[j].name}`).toBe(false);
        }
      for (const b of boxes) {
        expect(b[0]).toBeGreaterThanOrEqual(-0.1);
        expect(b[2]).toBeLessThanOrEqual(width + 0.1);
      }
    }
  });
});

describe('placeLabels, a person standing right by the place they are near', () => {
  it('moves the place name a line up or down rather than leave the tag over it', () => {
    const frame = { x: 0, y: 0, w: 100, h: 60 };
    const out = placeLabels({
      // In the right-hand quarter, so the tag goes left, where the name is.
      labels: [{ name: 'Sunward Plain', x: 70, y: 30, landmark: false }],
      frame,
      people: [{ id: 'companion', name: 'Wren', x: 80, y: 30, near: 'Sunward Plain' }],
      width: 1000,
      rPx: 5,
    });
    const [name] = out.places;
    expect(name).toBeTruthy();
    // The tag goes left of the disc at y 30; the name now sits on another line.
    expect(out.people[0].side).toBe('l');
    expect(Math.abs(name.y - 30)).toBeGreaterThan(1);
  });
});
