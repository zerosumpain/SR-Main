import { describe, expect, it } from 'vitest';
import { luminance, over, skyAt } from './sky';
import { windows } from './showcase-place';
import {
  CAP_DAY,
  CAP_NIGHT,
  ceiling,
  cityLight,
  cityVars,
  column,
  goldAt,
  landmark,
  quietBoxes,
  shadows,
  skyline,
  SURFACE_LUM,
  windowGrid,
  type Chapter,
  type CityLight,
} from './showcase-city';

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** WCAG contrast of a colour (alpha composited over `bg`) against `bg`. */
function contrast(fg: number[], bg: string): number {
  const b = hex(bg);
  const a = fg[3] ?? 1;
  const f = [0, 1, 2].map((i) => fg[i] * a + b[i] * (1 - a));
  const l1 = luminance(f);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Every degree from deep night to a high summer sun, climbing and sinking. */
const ALTS = Array.from({ length: 111 }, (_, i) => i - 40);
const light = (alt: number, rising: boolean) => cityLight(skyAt(alt, rising), alt);
const ALL: Array<{ at: string; c: CityLight }> = ALTS.flatMap((alt) =>
  [true, false].map((rising) => ({ at: `${alt}° ${rising ? 'rising' : 'setting'}`, c: light(alt, rising) })),
);
const CHAPTERS: Chapter[] = ['observatory', 'walk', 'house', 'works'];

/** The faintest cream any of the showcase's type is set in. */
const CREAM = [237, 228, 212, 0.86];

/** Everything type can stand on: every surface and every stop of every chapter's sky, bare and with a tower's hairline across it. */
function grounds(c: CityLight): Array<[string, string]> {
  const plain: Array<[string, string]> = [
    ...Object.entries(c.surface),
    ...CHAPTERS.flatMap((k): Array<[string, string]> => [
      [`${k} sky top`, c.chapters[k].top],
      [`${k} sky low`, c.chapters[k].low],
    ]),
  ];
  return [...plain, ...plain.map(([k, v]): [string, string] => [`${k} under a hairline`, over(c.edge, v)])];
}

describe('the city’s light', () => {
  it('keeps every surface and every chapter sky under the ceiling, at every degree', () => {
    for (const { at, c } of ALL) {
      expect(c.cap).toBeGreaterThanOrEqual(CAP_NIGHT - 1e-4);
      expect(c.cap).toBeLessThanOrEqual(CAP_DAY + 1e-4);
      for (const [k, v] of Object.entries(c.surface))
        expect(luminance(v), `${k} at ${at}`).toBeLessThanOrEqual((k === 'far' ? c.cap : Math.min(SURFACE_LUM, c.cap)) + 1e-4);
      for (const k of CHAPTERS)
        for (const v of [c.chapters[k].top, c.chapters[k].low]) expect(luminance(v), `${k} sky at ${at}`).toBeLessThanOrEqual(c.cap + 1e-4);
    }
  });
  it('keeps cream at 86% and every tone at 4.5:1 on everything type stands on, a hairline across it or not', () => {
    for (const { at, c } of ALL)
      for (const [k, v] of grounds(c)) {
        expect(contrast(CREAM, v), `cream on ${k} at ${at}`).toBeGreaterThanOrEqual(4.5);
        for (const [name, col] of Object.entries(c.tone)) expect(contrast(hex(col), v), `${name} on ${k} at ${at}`).toBeGreaterThanOrEqual(4.5);
      }
  });
  it('raises the ceiling and lightens the tones with the day', () => {
    expect(ceiling(0)).toBe(CAP_NIGHT);
    expect(ceiling(1)).toBe(CAP_DAY);
    const night = light(-30, false);
    const day = light(45, true);
    expect(luminance(night.tone.accent)).toBeLessThan(luminance('#f0a058'));
    expect(luminance(night.tone.good)).toBeLessThan(luminance('#a4b470'));
    expect(luminance(day.tone.good)).toBeGreaterThan(luminance(night.tone.good));
    expect(luminance(day.tone.accent)).toBeGreaterThan(luminance(night.tone.accent));
  });
  it('keeps the panes that are data plain against the tower and the panes still dark, day or night', () => {
    for (const { at, c } of ALL)
      for (const p of [c.pane, c.pane2]) {
        expect(contrast(hex(p), c.surface.body), `pane on the tower at ${at}`).toBeGreaterThanOrEqual(3);
        expect(contrast(hex(p), '#070a10'), `pane beside a dark one at ${at}`).toBeGreaterThanOrEqual(3);
      }
  });
  it('turns the panes gold in a low sun, not grey', () => {
    const p = light(6, true).pane;
    const [r, g, b] = hex(p);
    expect(r - b, p).toBeGreaterThan(40);
    expect(g).toBeGreaterThan(b);
  });
  it('reads as day by day and night by night', () => {
    const night = light(-30, false);
    const day = light(45, true);
    expect(luminance(day.surface.body)).toBeGreaterThan(luminance(night.surface.body) * 2);
    const [r, , b] = hex(day.surface.body);
    expect(b).toBeGreaterThan(r + 20);
    // The panes are lamps after dark and bright glass by day.
    const [pr, , pb] = hex(night.pane);
    const [dr, , db] = hex(day.pane);
    expect(pr).toBeGreaterThan(pb);
    expect(db).toBeGreaterThan(dr);
    expect(night.shadow).toBe(0);
    expect(day.shadow).toBeGreaterThan(0);
    expect(night.glintOn).toBe(0);
    expect(night.sunOn).toBe(0);
    // The far street pales toward the sky by day.
    expect(luminance(day.surface.far)).toBeGreaterThan(luminance(day.surface.body));
    // The moon: cream at night, a paler, cooler disc by day.
    expect(hex(day.moon)[2]).toBeGreaterThan(hex(night.moon)[2]);
  });
  it('lights every chapter’s sky by the owner’s sun: navy at night, blue at the blue hour, cobalt and twice as bright by day', () => {
    const night = light(-30, false);
    const blue = light(-5, false);
    const day = light(45, true);
    for (const k of CHAPTERS) {
      for (const c of [night, blue, day]) {
        const [r, , b] = hex(c.chapters[k].top);
        expect(b, `${k} top is blue`).toBeGreaterThan(r);
      }
      expect(luminance(blue.chapters[k].top), `${k} blue hour over night`).toBeGreaterThan(luminance(night.chapters[k].top) * 1.5);
      expect(luminance(day.chapters[k].top), `${k} day over night`).toBeGreaterThan(luminance(night.chapters[k].top) * 3);
      expect(luminance(day.chapters[k].top), `${k} day over the old ceiling`).toBeGreaterThan(CAP_NIGHT * 1.5);
    }
  });
  it('gilds the light with the sun low: the skyline glow, the sunlit faces, the glints, the chapter skies', () => {
    expect(goldAt(-10)).toBe(0);
    expect(goldAt(3)).toBe(1);
    expect(goldAt(8)).toBe(1);
    expect(goldAt(30)).toBe(0);
    const low = light(6, true);
    const high = light(45, true);
    const warm = (c: string) => hex(c)[0] - hex(c)[2];
    const hz = (s: string) => s.match(/[\d.]+/g)!.map(Number);
    expect(hz(low.haze)[0] - hz(low.haze)[2]).toBeGreaterThan(hz(high.haze)[0] - hz(high.haze)[2] + 40);
    expect(warm(low.sunlit)).toBeGreaterThan(warm(high.sunlit));
    expect(low.sunOn).toBeGreaterThan(high.sunOn);
    expect(low.glintOn).toBeGreaterThan(high.glintOn);
    expect(low.reach).toBeGreaterThan(high.reach);
    for (const k of CHAPTERS) expect(warm(low.chapters[k].low), k).toBeGreaterThan(warm(high.chapters[k].low));
    // No glint with the sun under the skyline.
    expect(light(-3, false).glintOn).toBe(0);
  });
  it('glows sodium along the skyline at night', () => {
    const [r, , b, a] = light(-30, false).haze.match(/[\d.]+/g)!.map(Number);
    expect(r).toBeGreaterThan(b);
    expect(a).toBeGreaterThan(0.15);
  });
  it('never jumps between neighbouring degrees', () => {
    for (let i = 1; i < ALTS.length; i++)
      for (const rising of [true, false]) {
        const a = light(ALTS[i - 1], rising);
        const b = light(ALTS[i], rising);
        const pairs: Array<[string, string, string]> = [
          ...(Object.keys(a.surface) as Array<keyof CityLight['surface']>).map((k): [string, string, string] => [k, a.surface[k], b.surface[k]]),
          ...CHAPTERS.flatMap((k): Array<[string, string, string]> => [
            [`${k} top`, a.chapters[k].top, b.chapters[k].top],
            [`${k} low`, a.chapters[k].low, b.chapters[k].low],
          ]),
        ];
        for (const [k, x, y] of pairs) {
          const d = hex(x).map((v, j) => Math.abs(v - hex(y)[j]));
          expect(Math.max(...d), `${k} at ${ALTS[i]}°`).toBeLessThanOrEqual(12);
        }
      }
  });
  it('writes its light as CSS properties and nothing about where', () => {
    const v = cityVars(light(20, true));
    expect(v).toContain('--city-body:#');
    expect(v).toContain('--city-pane:#');
    expect(v).toContain('--city-sky-walk-top:#');
    expect(v).toContain('--accent-on-dark:#');
    expect(v).toContain('--good-on-dark:#');
    expect(v).toMatch(/--city-shadow:[\d.]+/);
    expect(v).not.toMatch(/lat|lon|zone|offset/i);
  });
  it('keeps the copy column to its side of the scene', () => {
    expect(column('l').to).toBeGreaterThanOrEqual(350);
    expect(column('r').from).toBeLessThanOrEqual(650);
  });
});

describe('skyline', () => {
  const opts = { seed: 3, from: -200, to: 1200, base: 500, lo: 60, hi: 200, clear: [[400, 600]] as Array<[number, number]>, dark: [[0, 300]] as Array<[number, number]> };
  it('draws the same street every time, within its span and clear of the stretches kept open', () => {
    const s = skyline(opts);
    expect(skyline(opts)).toEqual(s);
    expect(s.towers.length).toBeGreaterThan(8);
    for (const t of s.towers) {
      expect(t.x).toBeGreaterThanOrEqual(-200);
      expect(t.x).toBeLessThan(1200);
      expect(t.x + t.w <= 400 || t.x >= 600, `tower at ${t.x}`).toBe(true);
      expect(t.top).toBeGreaterThanOrEqual(500 - 200);
      expect(t.d.startsWith('M')).toBe(true);
    }
  });
  it('lights no window in the dark stretches or behind a label, and the street stays put', () => {
    const quiet = [{ x: 650, y: 300, w: 300, h: 200 }];
    const s = skyline({ ...opts, quiet });
    const runs = [...s.lit.matchAll(/M([\d.-]+),([\d.-]+)h([\d.]+)/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3] }));
    expect(runs.length).toBeGreaterThan(0);
    for (const r of runs) {
      expect(r.x + r.w <= 0 || r.x >= 300, `run at ${r.x}`).toBe(true);
      expect(r.x + r.w <= 650 || r.x >= 950 || r.y + 3.4 <= 300 || r.y >= 500, `run at ${r.x},${r.y}`).toBe(true);
    }
    expect(s.towers).toEqual(skyline(opts).towers);
    expect(s.lit.length).toBeLessThan(skyline(opts).lit.length);
  });
  it('puts no sunlit face, glint or sheen on a tower in a dark stretch', () => {
    const s = skyline(opts);
    const xs = (d: string) => [...d.matchAll(/M([\d.-]+),/g)].map((m) => +m[1]);
    for (const d of [s.sunL, s.sunR, s.edgeL, s.edgeR, s.sheen]) {
      expect(d.length).toBeGreaterThan(0);
      for (const x of xs(d)) expect(x < -40 || x >= 300 || x <= 0 - 1, `mark at ${x}`).toBe(true);
    }
    // Every tower still has its shaded faces.
    expect(xs(s.faceL)).toHaveLength(s.towers.length);
  });
  it('gives each street its own detail: mullions on glass, balconies on flats, plain fronts on the park', () => {
    const glass = skyline({ ...opts, street: 'glass' });
    const flats = skyline({ ...opts, street: 'flats' });
    const park = skyline({ ...opts, street: 'park' });
    expect(glass.detail).toMatch(/V500/);
    expect(flats.detail).toMatch(/h\d/);
    expect(park.detail).toBe('');
    expect(skyline({ ...opts, street: 'glass' })).toEqual(glass);
  });
  it('keeps a stretch low where it is told to', () => {
    const s = skyline({ ...opts, low: [[700, 1200, 50]] });
    for (const t of s.towers.filter((t) => t.x + t.w > 700)) expect(500 - t.top).toBeLessThanOrEqual(50);
  });
});

describe('landmark', () => {
  it('stands each landmark on the street, within its width, with its structure drawn', () => {
    for (const kind of ['taper', 'diagrid', 'crown'] as const) {
      const m = landmark(kind, 400, 60, 300, 500);
      expect(m.top).toBe(200);
      const pts = [...m.d.matchAll(/([\d.]+),([\d.]+)/g)].map((p) => [+p[1], +p[2]]);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(400);
        expect(x).toBeLessThanOrEqual(460);
        expect(y).toBeGreaterThanOrEqual(200);
        expect(y).toBeLessThanOrEqual(500);
      }
      expect(m.marks.length, kind).toBeGreaterThan(0);
    }
    expect(landmark('crown', 400, 60, 300, 500).glow).not.toBe('');
  });
});

describe('shadows', () => {
  const towers = [{ x: 100, w: 50, top: 300, d: '' }];
  it('falls away from the sun, and not at all with it down', () => {
    expect(shadows(towers, 'east', 0, 500)).toBe('');
    const east = shadows(towers, 'east', 1, 500);
    const west = shadows(towers, 'west', 1, 500);
    const far = (d: string) => Number(d.match(/L([\d.-]+),510/)![1]);
    expect(far(east)).toBeGreaterThan(150);
    expect(far(west)).toBeLessThan(100);
  });
});

describe('windowGrid and quietBoxes', () => {
  it('lays out every cell of the block, the lit ones exactly where windows() puts them', () => {
    const box = { x: 362, y: 146, w: 108, h: 324 };
    const g = windowGrid(61, 6, box);
    const cells = [...g.matchAll(/M([\d.]+),([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    expect(cells).toHaveLength(66);
    windows(61, 6, box).forEach((w, i) => expect(cells[i]).toEqual([w.x, w.y]));
    expect(windowGrid(null, 6, box)).toBe('');
  });
  it('boxes a label where it stands, and again where it pins on a tablet', () => {
    const one = quietBoxes([{ x: 500, y: 300, lead: 20, dir: 'up', hang: 'r' }]);
    expect(one).toHaveLength(1);
    expect(one[0].y + one[0].h).toBeLessThanOrEqual(300);
    expect(quietBoxes([{ x: 500, y: 300, lead: 20, hang: 'l', narrow: { lead: 60 } }])).toHaveLength(2);
  });
});
