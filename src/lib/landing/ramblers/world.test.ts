import { describe, expect, it } from 'vitest';
import { buildWorld, route, type SceneryRect } from './world';

const OPTS = { margin: 8, ladderHalf: 8 };

// A small landing page: a monitor box, a section rule, two rows of four
// touching cells and a footer.
function page(): SceneryRect[] {
  const cells: SceneryRect[] = [];
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 4; i++) cells.push({ key: 10 + row * 4 + i, x1: 100 + i * 250, x2: 350 + i * 250, y: 400 + row * 250 });
  return [
    { key: 1, x1: 100, x2: 1100, y: 100, spot: 'lookout', at: 0.9 },
    { key: 2, x1: 500, x2: 1000, y: 340 },
    ...cells,
    { key: 3, x1: 0, x2: 1200, y: 1000, spot: 'garage', at: 0.5 },
  ];
}

describe('buildWorld', () => {
  it('merges touching cells into one floor and keeps their seams', () => {
    const w = buildWorld(page(), OPTS);
    const row = w.floors.find((f) => f.y === 400)!;
    expect([row.x1, row.x2]).toEqual([100, 1100]);
    expect(row.seams).toEqual([350, 600, 850]);
    expect(w.floors).toHaveLength(5);
  });

  it('connects every floor to every other in both directions', () => {
    const w = buildWorld(page(), OPTS);
    for (const a of w.floors) for (const b of w.floors) if (a !== b) expect(route(w, a, a.x1 + 20, b), `${a.y} → ${b.y}`).not.toBeNull();
  });

  it('stands a ladder between two cells rather than across one', () => {
    const w = buildWorld(page(), OPTS);
    const between = w.ladders.find((l) => l.top.y === 400 && l.bot.y === 650)!;
    expect([350, 600, 850]).toContain(between.x);
  });

  it('lets him drop off the end of a ledge onto what is below', () => {
    const w = buildWorld(page(), OPTS);
    const rule = w.floors.find((f) => f.y === 340)!;
    const drops = w.links.filter((l) => l.type === 'drop' && l.from === rule);
    expect(drops.map((d) => d.to.y)).toEqual([400, 400]);
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

describe('side ladders', () => {
  it('leans against the element and reaches the floor below it', () => {
    const w = buildWorld(
      [
        { key: 1, x1: 100, x2: 900, y: 100, ladder: 'right' },
        { key: 2, x1: 0, x2: 1200, y: 300 },
      ],
      OPTS,
    );
    expect(w.ladders).toHaveLength(1);
    expect(w.ladders[0].x).toBe(914);
    const up = w.links.find((l) => l.type === 'ladder' && l.to.y === 100)!;
    expect(up.tx).toBe(892);
  });

  it('pulls the ladder in rather than drawing it off the page', () => {
    const w = buildWorld(
      [
        { key: 1, x1: 16, x2: 374, y: 100, ladder: 'right' },
        { key: 2, x1: 0, x2: 390, y: 300 },
      ],
      { ...OPTS, pageWidth: 390 },
    );
    expect(w.ladders[0].x).toBe(380);
  });
});
