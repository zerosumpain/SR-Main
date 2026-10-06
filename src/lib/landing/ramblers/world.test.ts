import { describe, expect, it } from 'vitest';
import { buildWorld, route, type Link, type SceneryRect } from './world';

const OPTS = { margin: 8, standOff: 8, jump: 52, drop: 160, pageWidth: 1200 };

// A small landing page: a monitor box over the ground, a section rule, two
// rows of four touching cells and a footer.
function page(): SceneryRect[] {
  const cells: SceneryRect[] = [];
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 4; i++) cells.push({ key: 10 + row * 4 + i, x1: 100 + i * 250, x2: 350 + i * 250, y: 400 + row * 250, bottom: 650 + row * 250 });
  return [
    { key: 1, x1: 100, x2: 1100, y: 100, bottom: 290, spot: 'lookout', at: 0.9 },
    { key: 4, x1: 0, x2: 1200, y: 320, bottom: 320 },
    { key: 2, x1: 500, x2: 1000, y: 360, bottom: 361 },
    ...cells,
    { key: 3, x1: 0, x2: 1200, y: 1400, bottom: 1460, spot: 'garage', at: 0.5 },
  ];
}

const climbs = (links: Link[], type: Link['type']) => links.filter((l) => l.type === type);

describe('buildWorld', () => {
  it('merges touching cells into one floor and keeps their seams', () => {
    const w = buildWorld(page(), OPTS);
    const row = w.floors.find((f) => f.y === 400)!;
    expect([row.x1, row.x2]).toEqual([100, 1100]);
    expect(row.seams).toEqual([350, 600, 850]);
    expect(w.floors).toHaveLength(6);
  });

  it('connects every floor to every other in both directions', () => {
    const w = buildWorld(page(), OPTS);
    for (const a of w.floors) for (const b of w.floors) if (a !== b) expect(route(w, a, a.x1 + 20, b), `${a.y} → ${b.y}`).not.toBeNull();
  });

  it('scales the side of a box whose wall comes down near the floor', () => {
    const w = buildWorld(page(), OPTS);
    const up = climbs(w.links, 'wall').find((l) => l.to.y === 100 && l.type === 'wall' && l.up)!;
    expect(up).toMatchObject({ ax: 1108, face: -1, wallBottom: 290 });
    expect(up.from.y).toBe(320);
  });

  it('jumps a gap shorter than his jump', () => {
    const w = buildWorld(page(), OPTS);
    const jump = climbs(w.links, 'jump').find((l) => l.from.y === 400 && l.to.y === 360);
    expect(jump).toBeDefined();
  });

  it('throws a rope up a cell seam where there is no wall to climb', () => {
    const w = buildWorld(page(), OPTS);
    const rope = climbs(w.links, 'rope').find((l) => l.from.y === 650 && l.to.y === 400)!;
    expect([350, 600, 850]).toContain(rope.type === 'rope' && rope.ax);
  });

  it('hangs a rope over the side when the wall stops far above the floor', () => {
    const w = buildWorld(page(), OPTS);
    const rope = climbs(w.links, 'rope').find((l) => l.from.y === 1400 && l.to.y === 650)!;
    expect(rope.type === 'rope' && rope.ax).toBe(1108);
  });

  it('never steps off a ledge into a deep drop', () => {
    const w = buildWorld(page(), OPTS);
    for (const d of climbs(w.links, 'drop')) expect(d.to.y - d.from.y).toBeLessThanOrEqual(160);
  });

  it('keeps a climb off the side on the page', () => {
    const w = buildWorld(
      [
        { key: 1, x1: 16, x2: 374, y: 100, bottom: 300 },
        { key: 2, x1: 0, x2: 390, y: 320 },
      ],
      { ...OPTS, pageWidth: 390 },
    );
    const up = w.links.find((l) => l.type !== 'drop' && l.up)!;
    expect(up.type !== 'drop' && up.ax).toBeLessThanOrEqual(382);
  });

  it('places spots on their floor, inside its margins', () => {
    const w = buildWorld(page(), OPTS);
    expect(w.spots.lookout).toMatchObject({ x: 1000 });
    expect(w.spots.lookout!.floor.y).toBe(100);
    expect(w.spots.garage!.x).toBe(600);
  });

  it('ignores slivers too narrow to stand on', () => {
    const w = buildWorld([{ key: 1, x1: 0, x2: 10, y: 10 }, { key: 2, x1: 0, x2: 300, y: 200 }], OPTS);
    expect(w.floors).toHaveLength(1);
  });

  it('returns no route between floors that never overlap', () => {
    const w = buildWorld([{ key: 1, x1: 0, x2: 100, y: 10 }, { key: 2, x1: 500, x2: 600, y: 300 }], OPTS);
    expect(route(w, w.floors[0], 50, w.floors[1])).toBeNull();
  });
});

describe('long climbs', () => {
  it('goes level by level rather than roping the whole page', () => {
    const w = buildWorld(page(), { ...OPTS, longest: 700 });
    const top = w.floors.find((f) => f.y === 320)!;
    const footer = w.floors.find((f) => f.y === 1400)!;
    expect(w.links.some((l) => l.from === top && l.to === footer)).toBe(false);
    expect(route(w, top, 600, footer)!.length).toBeGreaterThan(1);
  });

  it('still takes a long rope when nothing shorter connects', () => {
    const w = buildWorld([{ key: 1, x1: 100, x2: 900, y: 100 }, { key: 2, x1: 0, x2: 1000, y: 1000 }], { ...OPTS, longest: 300 });
    expect(route(w, w.floors[1], 500, w.floors[0])).not.toBeNull();
  });
});
