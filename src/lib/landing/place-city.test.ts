import { describe, expect, it } from 'vitest';
import { city, cityLight, cityVars, ratio, seeded } from './place-city';
import { luminance, skyAt } from './sky';
import { shipDays } from './rhythm';
import { TOWN_DAYS } from './place';

const panes = (d: string) => d.match(/M/g)?.length ?? 0;

describe('the street', () => {
  const days = shipDays([{ date: '2026-10-07', count: 3 }, { date: '2026-10-08', count: 2 }], '2026-10-09');

  it('stands a building a day for forty days and lights a pane per deploy', () => {
    const c = city(days);
    expect(c.buildings).toHaveLength(TOWN_DAYS);
    expect(panes(c.lit) + panes(c.lit2)).toBe(5);
    expect(c.perFloor).toBe(1);
  });

  it('gives every building a storey for every pane its day needs', () => {
    const busy = shipDays(Array.from({ length: 40 }, (_, i) => ({ date: new Date(Date.parse('2026-08-31T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10), count: (i * 5) % 13 })), '2026-10-09');
    const c = city(busy);
    busy.forEach((d, i) => expect(c.buildings[i].floors * c.perFloor).toBeGreaterThanOrEqual(d.count));
    expect(panes(c.lit) + panes(c.lit2)).toBe(busy.reduce((s, d) => s + d.count, 0));
    // Every storey of every building has its pane, lit or not.
    expect(panes(c.lit) + panes(c.lit2) + panes(c.dark)).toBe(c.buildings.reduce((s, b) => s + b.floors * c.perFloor, 0));
  });

  it('puts two panes to a storey rather than clip a very busy day', () => {
    const c = city(shipDays([{ date: '2026-10-09', count: 20 }], '2026-10-09'));
    expect(c.perFloor).toBe(2);
    expect(panes(c.lit) + panes(c.lit2)).toBe(20);
  });

  it('keeps the street in order, inside its box, today at the right', () => {
    const c = city(days);
    for (let i = 1; i < c.buildings.length; i++) expect(c.buildings[i].x).toBeGreaterThan(c.buildings[i - 1].x + c.buildings[i - 1].w);
    expect(c.buildings[0].x).toBeGreaterThanOrEqual(0);
    const last = c.buildings.at(-1)!;
    expect(last.x + last.w).toBeLessThanOrEqual(1000.5);
    expect(c.today.x).toBe(last.x);
    expect(c.today.x).toBeGreaterThan(940);
    for (const b of c.buildings) {
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.top).toBeLessThan(100);
    }
    const ys = [...`${Object.values(c.bodies).join('')}${c.masts}`.matchAll(/[MLV,](-?[\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });

  it('draws each day the same building wherever it stands in the street', () => {
    const a = city(days);
    const tomorrow = city(shipDays([{ date: '2026-10-07', count: 3 }, { date: '2026-10-08', count: 2 }], '2026-10-10'));
    const by = (c: typeof a, date: string) => c.buildings.find((b) => b.date === date)!;
    for (const date of ['2026-09-15', '2026-10-07']) {
      expect(by(tomorrow, date).form).toBe(by(a, date).form);
      expect(by(tomorrow, date).material).toBe(by(a, date).material);
    }
    expect(city(days)).toEqual(a);
    // A mix of forms, not one repeated.
    expect(new Set(a.buildings.map((b) => b.form)).size).toBeGreaterThanOrEqual(4);
  });

  it('pins the ship label to a roof near the street’s start', () => {
    const c = city(days);
    expect(c.pin.x).toBeGreaterThan(0.1);
    expect(c.pin.x).toBeLessThan(0.3);
    expect(c.pin0.x).toBeLessThan(c.pin.x);
    for (const p of [c.pin, c.pin0]) {
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('draws modern forms: a curtain wall with mullions and slabs, no spires or crowns', () => {
    const busy = shipDays(Array.from({ length: 40 }, (_, i) => ({ date: new Date(Date.parse('2026-08-31T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10), count: (i * 5) % 13 })), '2026-10-09');
    const c = city(busy);
    const forms = new Set(c.buildings.map((b) => b.form as string));
    expect(forms.has('spire')).toBe(false);
    expect(forms.has('crown')).toBe(false);
    expect([...forms].some((f) => ['shard', 'chamfer', 'cantilever'].includes(f))).toBe(true);
    expect(panes(c.mullions)).toBe(c.buildings.length * 2);
    expect(c.bands).toMatch(/^M/);
  });

  it('keeps every pane inside its own building, up a raked shard too', () => {
    const busy = shipDays(Array.from({ length: 40 }, (_, i) => ({ date: new Date(Date.parse('2026-08-31T00:00:00Z') + i * 86_400_000).toISOString().slice(0, 10), count: 3 + (i % 9) })), '2026-10-09');
    const c = city(busy);
    const rects = [...`${c.lit}${c.lit2}${c.dark}`.matchAll(/M([\d.]+),([\d.]+)h([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[3])]);
    expect(rects.length).toBeGreaterThan(200);
    for (const [x, w] of rects) {
      const b = c.buildings.find((q) => x >= q.x - 0.15 && x <= q.x + q.w);
      expect(b, `pane at ${x}`).toBeDefined();
      expect(x + w).toBeLessThanOrEqual(b!.x + b!.w + 0.15);
      expect(w).toBeGreaterThan(0);
    }
  });

  it('streams the same numbers for the same key', () => {
    const a = seeded('2026-10-09');
    const b = seeded('2026-10-09');
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('the city’s light', () => {
  const sweep = () => {
    const out = [];
    for (let alt = -40; alt <= 70; alt += 0.5) for (const rising of [true, false]) out.push({ alt, rising, s: skyAt(alt, rising) });
    return out;
  };

  it('keeps a lit pane 3:1 against the glass it sits in, and against an unlit one, at every altitude', () => {
    for (const { alt, rising, s } of sweep()) {
      const c = cityLight(s);
      const at = `${alt}° ${rising ? 'rising' : 'setting'}`;
      expect(ratio(c.pane, c.glaze), `pane at ${at}`).toBeGreaterThanOrEqual(3);
      expect(ratio(c.pane2, c.glaze), `pale pane at ${at}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the cloud’s fill and its edge 3:1 against its body, night and day', () => {
    for (const { alt, rising, s } of sweep()) {
      const c = cityLight(s);
      const at = `${alt}° ${rising ? 'rising' : 'setting'}`;
      expect(ratio(c.cloudFill, c.cloud), `fill at ${at}`).toBeGreaterThanOrEqual(3);
      expect(ratio(c.cloudLine, c.cloud), `edge at ${at}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('lights the city by day and leaves silhouettes at night', () => {
    const night = cityLight(skyAt(-30, false));
    const day = cityLight(skyAt(45, true));
    expect(night.shade).toBe(0);
    expect(night.sunFace).toBe(0);
    expect(day.shade).toBeGreaterThan(0.2);
    // Brighter glass, stone and metal by day.
    for (let i = 0; i < 3; i++) expect(ratio(day.frame[i], night.frame[i])).toBeGreaterThan(2);
    // The low sun catches the towers harder than the high one.
    expect(cityLight(skyAt(2, false)).sunFace).toBeGreaterThan(day.sunFace);
    // The farther range is paler than the nearer: distance is haze.
    for (const s of [skyAt(-30, true), skyAt(2, false), skyAt(45, true)]) {
      const c = cityLight(s);
      expect(ratio(c.far, '#000000')).toBeGreaterThan(ratio(c.near, '#000000'));
    }
  });

  it('turns the street to sunlit glass by day: glints, not lamplit windows, and a cool shade', () => {
    const night = cityLight(skyAt(-30, false));
    const day = cityLight(skyAt(45, true));
    expect(day.pane).not.toBe(night.pane);
    expect(luminance(day.pane)).toBeGreaterThan(0.8);
    expect(day.paneEdge).not.toBe('none');
    expect(night.paneEdge).toBe('none');
    expect(day.shadeFill).not.toBe('#000000');
    // The glass reflects the sky: a mid blue, far lighter than the night's.
    expect(luminance(day.glaze)).toBeGreaterThan(0.12);
    // Lit up by day the far skyline darkens, so lighting up still adds contrast on a pale sky.
    expect(ratio(day.nearOn, '#ffffff')).toBeGreaterThan(ratio(day.near, '#ffffff'));
    // The two far ranges stand apart by day.
    expect(ratio(day.far, day.near)).toBeGreaterThan(1.3);
    // A white cloud on the daytime sky, an ink one at night.
    expect(luminance(day.cloud)).toBeGreaterThan(0.7);
    expect(luminance(night.cloud)).toBeLessThan(0.02);
  });

  it('hands the light to CSS as custom properties, and nothing about where', () => {
    const v = cityVars(cityLight(skyAt(5, false)));
    for (const k of ['--city-glass', '--city-stone', '--city-metal', '--city-glaze', '--city-pane', '--city-pane2', '--city-pane-edge', '--city-unlit', '--city-mullion', '--city-band', '--city-near', '--city-near-on', '--city-far', '--city-sunface', '--city-shade', '--city-shade-fill', '--city-cloud', '--city-cloud-fill', '--city-cloud-line', '--city-cloud-rim'])
      expect(v).toContain(`${k}:`);
    expect(v).not.toMatch(/lat|lon|zone|offset/i);
  });
});
