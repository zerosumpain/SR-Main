import { describe, expect, it } from "vitest";
import recorded from "./fixtures/wildmind-day16.json";
import { parseSnapshot, project, type WildmindMap } from "./wildmind";
import { traceGrid } from "./wildmind-trace.server";
import { CAMP_MIN, CAMP_PAD, campPath, campRing, camps, hull } from "./notes-map-marks";
import {
  LAYOUT_KEYS,
  layoutsFor,
  mapPx,
  markScale,
  neatStrips,
  pencilMap,
  pencilPath,
  quadClosed,
  ringsOf,
  scaleBar,
} from "./notes-map-pencil";
import {
  EDGE,
  SIDES,
  geometry,
  layoutWords,
  mapWords,
  placeBox,
  seenAt,
  tagBoxes,
  type WordsInput,
} from "./notes-map-words";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const snap = parseSnapshot(recorded)!;
const w = project(
  snap,
  NOW,
  NOW,
  traceGrid(snap.terrain!, snap.terrainVersion),
);
const map = w.map!;
const tagged = (people = w.people) =>
  people.map((p) => ({ ...p, tag: `${p.name} is ${p.doing}` }));

type Box = [number, number, number, number];
const hits = (a: Box, b: Box) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

describe("pencilMap", () => {
  it("reads the tracer’s staircase rings", () => {
    expect(ringsOf("M0 0h2v1h-2Z M5 5h1v1h-1v-1Z")).toEqual([
      [
        [0, 0],
        [2, 0],
        [2, 1],
        [0, 1],
      ],
      [
        [5, 5],
        [6, 5],
        [6, 6],
        [5, 6],
      ],
    ]);
  });

  it("is the same wobble every time for a version, and keeps every ring closed", () => {
    const a = pencilPath(map.seen, 7);
    expect(pencilPath(map.seen, 7)).toBe(a);
    expect(pencilPath(map.seen, 8)).not.toBe(a);
    const rings = a.match(/M/g)?.length;
    expect(rings).toBe(ringsOf(map.seen).length);
    expect(a.match(/z/g)?.length).toBe(rings);
  });

  it("draws fewer points than the staircase had corners", () => {
    const p = pencilMap(map);
    const corners = [map.seen, ...map.layers.map((l) => l.d)].reduce(
      (s, d) => s + ringsOf(d).flat().length,
      0,
    );
    const points = [p.seen, ...p.layers.map((l) => l.d)].reduce(
      (s, d) => s + (d.match(/q/g)?.length ?? 0),
      0,
    );
    expect(points).toBeLessThan(corners / 2);
    expect(points).toBeGreaterThan(100);
  });

  it("keeps a one-cell pond as a small round", () => {
    const d = pencilPath("M3 3h1v1h-1Z", 1);
    expect(d.match(/q/g)?.length).toBe(4);
    // Walk the relative steps back to points: every one stays within the cell's reach.
    const nums = (t: string) => (t.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const [mx, my] = nums(d.slice(1, d.indexOf("q")));
    let x = mx;
    let y = my;
    const xs = [x];
    for (const seg of d.slice(d.indexOf("q") + 1, -1).split("q")) {
      const [, , ex, ey] = nums(seg);
      x += ex;
      y += ey;
      xs.push(x);
    }
    expect(Math.min(...xs)).toBeGreaterThan(2.7);
    expect(Math.max(...xs)).toBeLessThan(4.3);
    expect(Math.abs(x - mx) + Math.abs(y - my)).toBeLessThan(0.05);
  });

  it("writes numbers as short as SVG allows and still parses back", () => {
    const d = quadClosed([
      [0.25, 0.25],
      [10.5, 0.3],
      [10.4, 9.6],
      [0.3, 9.5],
    ]);
    expect(d).not.toMatch(/\b0\./);
    expect(d).toMatch(/^M[\d.]+ [\d.]+q/);
    expect(d.endsWith("z")).toBe(true);
  });

  it("memoises by version, keeps the classes and drops relief", () => {
    const p = pencilMap(map);
    expect(pencilMap(map)).toBe(p);
    expect(p.relief).toBeNull();
    expect(p.layers.map((l) => l.cls)).toEqual(
      map.layers.map((l) => l.cls).filter((c) => c !== "open"),
    );
    expect(p.labels).toBe(map.labels);
  });
});

describe("mapPx", () => {
  it("matches the page’s frame sums", () => {
    expect(mapPx(map, 1038, false, false)).toMatchObject({ fh: 672, mh: 652 });
    expect(Math.round(mapPx(map, 1038, false, false).mw)).toBe(989);
    expect(mapPx(map, 726, false, false).fh).toBe(448);
    const t = mapPx(map, 314, true, true);
    expect(t.fh).toBe(480);
    expect(Math.round(t.mh)).toBe(294);
  });
});

describe("mapWords", () => {
  const input: WordsInput = { map, people: tagged(), met: w.met };

  it("places every word inside the map and clear of the others, in every layout", () => {
    for (const lay of layoutsFor(map)) {
      const r = layoutWords(input, lay);
      const { W, H, at } = geometry(map, lay);
      const boxes: Box[] = [];
      for (const p of input.people) {
        const [X, Y] = at(p.x, p.y);
        boxes.push(...tagBoxes(X, Y, r.sides[p.id], p.tag.length, lay.tagPx));
      }
      for (const [name, dir] of r.places) {
        const l = map.labels.find((x) => x.name === name)!;
        const by = r.crossless.get(name);
        const [X, Y] = by ? at(by[0], by[1]) : at(l.x, l.y);
        boxes.push(placeBox(X, Y, dir, name.length, lay.placePx, !!by));
      }
      for (const b of boxes) {
        expect(b[0]).toBeGreaterThanOrEqual(EDGE - 0.01);
        expect(b[1]).toBeGreaterThanOrEqual(EDGE - 0.01);
        expect(b[2]).toBeLessThanOrEqual(W - EDGE + 0.01);
        expect(b[3]).toBeLessThanOrEqual(H - EDGE + 0.01);
      }
      // A tag's words and its own arrow meet where the arrow starts; nothing else touches.
      const tagParts = input.people.length * 2;
      boxes.forEach((a, i) =>
        boxes
          .slice(i + 1)
          .forEach((b, j) =>
            i < tagParts && i % 2 === 0 && j === 0
              ? null
              : expect(hits(a, b)).toBe(false),
          ),
      );
      expect(r.places.size).toBeLessThanOrEqual(lay.max);
    }
  });

  it("writes at most six names wide and three narrow, landmarks first", () => {
    const words = mapWords(input);
    const count = (k: "w" | "n" | "t") =>
      words.places.filter((l) => l.at[k] !== 0).length;
    expect(count("w")).toBeLessThanOrEqual(6);
    expect(count("n")).toBeLessThanOrEqual(3);
    expect(count("t")).toBeLessThanOrEqual(3);
    expect(count("w")).toBeGreaterThanOrEqual(4);
    const wide = words.places.filter((l) => l.at.w !== 0).map((l) => l.name);
    expect(wide).toContain("Mirror Mere");
    expect(wide).toContain("Upper Ford");
  });

  it("never writes Upper Ford and Tusker Wood over each other", () => {
    // The two sit eleven cells apart, with JKai between them: the mock collided here.
    const people = tagged(
      w.people.map((p) =>
        p.id === "main" ? { ...p, x: 36, y: 38, near: "Tusker Wood" } : p,
      ),
    );
    for (const lay of layoutsFor(map)) {
      const r = layoutWords({ map, people, met: false }, lay);
      const { at } = geometry(map, lay);
      const placed = ["Upper Ford", "Tusker Wood"]
        .filter((n) => r.places.has(n))
        .map((n) => {
          const l = map.labels.find((x) => x.name === n)!;
          const [X, Y] = at(l.x, l.y);
          return placeBox(X, Y, r.places.get(n)!, n.length, lay.placePx);
        });
      if (placed.length === 2) expect(hits(placed[0], placed[1])).toBe(false);
    }
  });

  it("keeps tags inside when someone stands at any edge, flat or turned", () => {
    for (const [x, y] of [
      [1, 1],
      [map.w - 1, 1],
      [1, map.h - 1],
      [map.w - 1, map.h - 1],
      [map.w / 2, 1],
      [1, map.h / 2],
    ]) {
      const people = [
        {
          id: "main" as const,
          name: "JKai",
          x,
          y,
          alive: true,
          near: null,
          tag: "JKai is walking",
        },
      ];
      for (const lay of layoutsFor(map)) {
        const r = layoutWords({ map, people, met: null }, lay);
        const { W, H, at } = geometry(map, lay);
        const [X, Y] = at(x, y);
        for (const b of tagBoxes(
          X,
          Y,
          r.sides.main,
          people[0].tag.length,
          lay.tagPx,
        )) {
          expect(b[0]).toBeGreaterThanOrEqual(0);
          expect(b[2]).toBeLessThanOrEqual(W);
          expect(b[1]).toBeGreaterThanOrEqual(0);
          expect(b[3]).toBeLessThanOrEqual(H);
        }
      }
    }
    expect(layoutsFor(map).find((l) => l.key === "t")!.turned).toBe(true);
    expect(
      layoutsFor({ w: 50, h: 50 }).find((l) => l.key === "t")!.turned,
    ).toBe(false);
  });

  it("says they haven’t met only when the snapshot says so", () => {
    expect(mapWords({ ...input, met: false }).met).not.toBeNull();
    expect(mapWords({ ...input, met: null }).met).toBeNull();
    expect(mapWords({ ...input, met: undefined }).met).toBeNull();
    expect(mapWords({ ...input, met: true }).met).toBeNull();
    // Not when one of them is dead, or they stand close.
    const dead = tagged(
      w.people.map((p) => (p.id === "main" ? { ...p, alive: false } : p)),
    );
    expect(mapWords({ ...input, people: dead, met: false }).met).toBeNull();
    const close = tagged(
      w.people.map((p) => (p.id === "main" ? { ...p, x: 110, y: 50 } : p)),
    );
    expect(mapWords({ ...input, people: close, met: false }).met).toBeNull();
  });

  describe("with the marks on the map", () => {
    const grouped = camps(w.structures);
    const marks = {
      huts: grouped.huts.map(([x, y]) => [x, y] as [number, number]),
      camped: grouped.camps.flat(),
      animals: w.animals.map(([x, y]) => [x, y] as [number, number]),
    };
    const full: WordsInput = { map, people: tagged(), met: false, marks };

    it("never stacks names into a list, nor leaves a cross that could be another name's", () => {
      for (const lay of layoutsFor(map)) {
        const r = layoutWords(full, lay);
        const { at } = geometry(map, lay);
        const th = 1.3 * lay.placePx;
        const written = [...r.places].map(([name, dir]) => {
          const l = map.labels.find((x) => x.name === name)!;
          const by = r.crossless.get(name);
          const [X, Y] = by ? at(by[0], by[1]) : at(l.x, l.y);
          return {
            name,
            box: placeBox(X, Y, dir, name.length, lay.placePx, !!by),
            cross: by ? null : ([X - 5, Y - 5, X + 5, Y + 5] as Box),
          };
        });
        const gaps = (a: Box, b: Box) => [
          Math.max(b[0] - a[2], a[0] - b[2]),
          Math.max(b[1] - a[3], a[1] - b[3]),
        ];
        for (const a of written)
          for (const b of written) {
            if (a === b) continue;
            const [gx, gy] = gaps(a.box, b.box);
            // Flush over or under another name reads as a list.
            if (gx < 0)
              expect(gy, `${lay.key} ${a.name} / ${b.name}`).toBeGreaterThanOrEqual(th);
            // A cross a name's height from someone else's name could be either's.
            if (a.cross) {
              const [cx, cy] = gaps(a.cross, b.box);
              expect(cx >= th || cy >= th, `${lay.key} ${a.name}'s cross by ${b.name}`).toBe(true);
            }
          }
      }
    });

    it("always writes the place each person is near, in every layout", () => {
      for (const lay of layoutsFor(map)) {
        const r = layoutWords(full, lay);
        for (const p of w.people)
          if (p.near)
            expect([...r.places.keys()], `${lay.key} ${p.near}`).toContain(
              p.near,
            );
      }
    });

    it("never writes a name or a cross over a hut or a camp, except the place someone is near", () => {
      const near = new Set(w.people.map((p) => p.near));
      for (const lay of layoutsFor(map)) {
        const r = layoutWords(full, lay);
        const { at, s } = geometry(map, lay);
        const huts: Box[] = [
          ...marks.huts.map((h) => [h, 0.5 * s] as const),
          ...marks.camped.map((h) => [h, 2.4 * s] as const),
        ].map(([[x, y], d]) => {
          const [X, Y] = at(x, y);
          return [X - d, Y - d, X + d, Y + d];
        });
        for (const [name, dir] of r.places) {
          if (near.has(name)) continue;
          const l = map.labels.find((x) => x.name === name)!;
          const [X, Y] = at(l.x, l.y);
          for (const b of [
            placeBox(X, Y, dir, name.length, lay.placePx),
            [X - 5, Y - 5, X + 5, Y + 5] as Box,
          ])
            for (const h of huts)
              expect(hits(b, h), `${lay.key} ${name}`).toBe(false);
        }
      }
    });

    it("says they haven’t met only on paper they haven’t seen", () => {
      const words = mapWords(full);
      expect(words.met).not.toBeNull();
      for (const lay of layoutsFor(map)) {
        const m = words.met![lay.key];
        if (!m) continue;
        expect(seenAt(map.seen, m.x * map.w, m.y * map.h), lay.key).toBe(false);
      }
      // A map seen all over has nowhere to say it.
      const everywhere = { ...map, seen: `M0 0h${map.w}v${map.h}h-${map.w}Z` };
      expect(mapWords({ ...full, map: everywhere }).met).toBeNull();
    });

    it("keeps the names it wrote when someone takes a small step", () => {
      const before = mapWords(full);
      const moved = tagged(
        w.people.map((p) =>
          p.id === "main" ? { ...p, x: p.x + 0.6, y: p.y - 0.4 } : p,
        ),
      );
      const after = mapWords({
        ...full,
        people: moved,
        prefer: before.places.map((l) => l.name),
      });
      for (const k of LAYOUT_KEYS) {
        const was = before.places
          .filter((l) => l.at[k] !== 0)
          .map((l) => l.name);
        const now = after.places
          .filter((l) => l.at[k] !== 0)
          .map((l) => l.name);
        expect(
          now.filter((n) => was.includes(n)).length,
          k,
        ).toBeGreaterThanOrEqual(was.length - 1);
      }
    });

    it("writes a near place by the person, with no cross, when they stand on it", () => {
      const wren = w.people.find((p) => p.id === "companion")!;
      const words = mapWords(full);
      const beds = words.places.find((l) => l.name === wren.near);
      expect(beds).toBeDefined();
      expect(Object.values(beds!.bare ?? {}).some(Boolean)).toBe(true);
    });
  });

  it("gives every person a side in every layout", () => {
    const words = mapWords(input);
    for (const p of w.people)
      for (const k of LAYOUT_KEYS)
        expect(SIDES).toContainEqual(words.tags[p.id][k]);
  });
});

describe("camps", () => {
  const hut = (x: number, y: number) =>
    [x, y, 1, 0, "shelter"] as [number, number, 0 | 1, 0 | 1, "shelter"];
  it("groups huts that stand close into camps and leaves the stragglers as huts", () => {
    const g = camps([
      hut(0, 0),
      hut(2, 0),
      hut(4, 1),
      hut(40, 40),
      hut(42, 40),
    ]);
    expect(g.camps).toEqual([
      [
        [0, 0],
        [2, 0],
        [4, 1],
      ],
    ]);
    expect(g.huts.map(([x, y]) => [x, y])).toEqual([
      [40, 40],
      [42, 40],
    ]);
    expect(CAMP_MIN).toBe(3);
  });
  it("draws a camp as one smooth fence round all its huts, not a cloud of discs", () => {
    const huts: Array<[number, number]> = [
      [1, 1],
      [3, 1],
      [2, 3],
      [2, 2],
    ];
    const d = campPath(huts);
    // One closed curve, no arcs (a union of discs scallops into a cumulus).
    expect(d.match(/M/g)?.length).toBe(1);
    expect(d).not.toMatch(/a/);
    expect(d.endsWith("z")).toBe(true);
    expect(campPath(huts)).toBe(d);
    // Convex, and every hut inside it with room to spare.
    const ring = campRing(huts);
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [ax, ay] = ring[i];
      const [bx, by] = ring[(i + 1) % n];
      for (const [x, y] of huts) {
        const side = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
        expect(side).toBeGreaterThan(0);
        const len = Math.hypot(bx - ax, by - ay);
        expect(side / len).toBeGreaterThan(CAMP_PAD * 0.85);
      }
    }
  });
  it("hulls points anticlockwise and drops the ones inside", () => {
    expect(
      hull([
        [0, 0],
        [2, 0],
        [1, 1],
        [2, 2],
        [0, 2],
      ]),
    ).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
  });
  it("groups by distance on the ground, whatever a map unit spans", () => {
    // Three huts 2.4 m apart: one camp on a two-metre map (1.2 units apart), and on a four-metre one (0.6 units).
    const row = [hut(0, 0), hut(1.2, 0), hut(2.4, 0)];
    expect(camps(row, 2).camps).toHaveLength(1);
    expect(camps(row.map(([x, y, ...r]) => [x / 2, y / 2, ...r] as typeof row[number]), 4).camps).toHaveLength(1);
    // Ten metres apart is two settlements, not one.
    expect(camps([hut(0, 0), hut(1, 0), hut(2, 0), hut(7, 0), hut(8, 0), hut(9, 0)], 2).camps).toHaveLength(2);
  });
  it("groups the fixture’s forty-odd shelters into a few camps", () => {
    const g = camps(w.structures);
    expect(g.camps.length).toBeGreaterThan(0);
    expect(g.camps.length).toBeLessThanOrEqual(4);
    expect(g.huts.length).toBeLessThan(6);
  });
});

describe("markScale", () => {
  it("is one for the day-16 map the marks were drawn for, and follows the map's pixels a unit", () => {
    expect(markScale({ w: 141, h: 93 })).toBeCloseTo(1, 2);
    // Twice the cells across the same page: each mark twice as many units, the same on screen.
    expect(markScale({ w: 282, h: 186 })).toBeCloseTo(2, 1);
    expect(markScale({ w: 70, h: 46 })).toBeCloseTo(0.5, 1);
  });
});

describe("scaleBar", () => {
  const m = (
    w: number,
    h: number,
  ): Pick<WildmindMap, "w" | "h" | "metresPerUnit"> => ({
    w,
    h,
    metresPerUnit: 2,
  });
  it("starts at a hundred metres and steps down or up to fit", () => {
    expect(scaleBar(m(141, 93))).toEqual({
      wide: { k: 0.3546, words: "a hundred metres" },
      turned: { k: 0.2688, words: "fifty metres" },
    });
    expect(scaleBar(m(60, 60)).wide.words).toBe("fifty metres");
    expect(scaleBar(m(1000, 1000)).wide.words).toBe("half a kilometre");
    expect(scaleBar(m(5000, 5000)).wide.words).toBe("a kilometre");
    expect(scaleBar(m(141, 93)).wide.k).toBeLessThanOrEqual(0.45);
  });
});

describe("neatStrips", () => {
  it("draws two boxes of four edges, each one stroke", () => {
    const s = neatStrips();
    expect(s).toHaveLength(8);
    expect(new Set(s.map((x) => `${x.box}-${x.edge}`)).size).toBe(8);
    for (const x of s) expect(x.d).toMatch(/^M-?[\d.]+,-?[\d.]+ C/);
    expect(neatStrips()).toEqual(s);
  });
});
