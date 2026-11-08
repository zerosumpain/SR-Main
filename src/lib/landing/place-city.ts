// place-city.ts — the landing hero's "place" view drawn as a modern city: the
// near street of forty buildings (one per day, a lit pane per deploy), and the
// light the whole skyline takes from the sky (./sky) at the sun's altitude.
//
// The forms are contemporary (glass curtain walls with thin mullions and floor
// slabs, setbacks, a raked shard, a chamfered crown, a cantilever), so the
// street reads as a city of now rather than of the thirties.
//
// The far skyline (every release day before the forty) is ./place's ridge;
// the showcase's works yard keeps ./place's terrace. This module is the hero's
// own.
//
// Pure: dates and counts in, path strings out, in a 1000×100 box the view
// stretches with CSS (x across, y down, the street at y = 100), so the server
// and the browser draw the same city at any width and nothing is measured.
// Each building's form and width come from its own date, so a day keeps its
// building as it moves left along the street.

import type { DayCount } from './rhythm';
import { luminance, mix, over, type Sky } from './sky';
import { TOWN_DAYS } from './place';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A repeatable 0..1 stream from a string (FNV-1a, then a small LCG). */
export function seeded(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619) >>> 0;
  let s = (h % 2147483646) + 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/* ------------------------------------------------------------- the street */

/**
 * The shapes a day's building takes, all of them current: a plain slab, a
 * setback, a stepped tower, a slanted roof, a shard (one face raked in toward
 * the top), a chamfered crown, a cantilever (the upper floors overhanging the
 * lower on one side) and a slender point tower. None is a copy of a real one.
 */
export type Form = 'tower' | 'setback' | 'stepped' | 'slant' | 'shard' | 'chamfer' | 'cantilever' | 'slender';
const FORMS: Form[] = ['tower', 'setback', 'shard', 'slant', 'chamfer', 'cantilever', 'slender', 'tower', 'stepped'];

export interface Building {
  date: string;
  /** The body's left edge and width, 0..1000. */
  x: number;
  w: number;
  /** The flat roof (the highest the body goes, not counting a mast), 0..100 down. */
  top: number;
  floors: number;
  form: Form;
  /** Which facade it wears: 0 blue glass, 1 pale stone, 2 dark metal. */
  material: 0 | 1 | 2;
}

export interface City {
  buildings: Building[];
  /** The bodies, one path per facade material, every tier and crown in it. */
  bodies: [string, string, string];
  /** The curtain wall across each body: the panes sit in it, a floor slab between each row. */
  glaze: string;
  /** Thin mullions down the curtain wall, under the lit panes. */
  mullions: string;
  /** A deeper spandrel band every few floors, across the whole body (never over a pane). */
  bands: string;
  /** Each tier's left and right faces outside the curtain wall, for the low sun and the shade. */
  faceL: string;
  faceR: string;
  /** Antennas on a few roofs, stroked. */
  masts: string;
  /** Lit panes, one per deploy, filled from the street up; every third a paler one. */
  lit: string;
  lit2: string;
  /** The panes of the floors nobody deployed on. */
  dark: string;
  /** Today's building, outlined so a dark today still reads as today. */
  today: { x: number; w: number; top: number };
  /** Where the ship label pins (a roof): x a share of the street, y up from its foot, both 0..1. */
  pin: { x: number; y: number };
  /** The same on a phone, further left. */
  pin0: { x: number; y: number };
  /** Panes per storey: 1 unless some day had more deploys than the tallest building has storeys. */
  perFloor: number;
}

const STOREYS = 14;
const GAP = 2;
/** The curtain wall's inset from each side of the body, by facade: glass and metal run nearly edge to edge, stone keeps a frame. */
const GLAZE_IN: [number, number, number] = [0.1, 0.2, 0.12];

/**
 * The last forty days as a street of buildings, oldest on the left, today on
 * the right. Each deploy lights one pane, filled from the street up, and every
 * building has a storey for every pane its day needs. Above that its height,
 * width and form are its date's own, so the street reads as a city rather than
 * a bar chart: only the lit panes are counted, never the storeys. A day busier
 * than fourteen storeys puts two panes (or more) to a floor rather than clip.
 */
export function city(days: DayCount[]): City {
  const list = days.length ? days : Array.from({ length: TOWN_DAYS }, (_, i) => ({ date: `day-${i}`, count: 0 }));
  const n = list.length;
  const peak = Math.max(1, ...list.map((d) => d.count));
  const perFloor = Math.ceil(peak / STOREYS);
  const need = list.map((d) => Math.ceil(d.count / perFloor));
  const H = Math.max(7, ...need);
  const draws = list.map((d) => {
    const rnd = seeded(d.date);
    return { weight: 0.8 + rnd() * 0.55, form: FORMS[Math.floor(rnd() * FORMS.length)], h: rnd(), material: Math.floor(rnd() * 3) as 0 | 1 | 2, mast: rnd(), flip: rnd() < 0.5 };
  });
  const floors = draws.map((d, i) => Math.max(need[i], 2, Math.round(H * (0.32 + 0.68 * d.h) * (d.form === 'slender' ? 1.12 : 1))));
  const tallest = Math.max(...floors);
  // Room above the tallest roof for an antenna or a chamfer.
  const pitch = Math.min(6.8, 76 / (tallest + 0.6));
  const sum = draws.reduce((s, d) => s + d.weight, 0);
  const room = 1000 - GAP * (n - 1);

  const bodies: [string, string, string] = ['', '', ''];
  let glaze = '';
  let mullions = '';
  let bands = '';
  let faceL = '';
  let faceR = '';
  let masts = '';
  let lit = '';
  let lit2 = '';
  let dark = '';
  let lamps = 0;
  const buildings: Building[] = [];
  const rect = (x: number, y: number, w: number, h: number) => `M${r1(x)},${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`;
  const poly = (pts: Array<[number, number]>) => `M${pts.map(([px, py]) => `${r1(px)},${r1(py)}`).join('L')}Z`;

  let at = 0;
  list.forEach((day, i) => {
    const d = draws[i];
    const slot = (room * d.weight) / sum;
    const k = d.form === 'slender' ? 0.68 : 0.86 + d.h * 0.14;
    const w = slot * k;
    const x = at + (slot - w) / 2;
    at += slot + GAP;
    const f = floors[i];
    const roofOf = (fl: number) => 100 - 4 - fl * pitch - 3;
    const top = roofOf(f);
    // A slanted roof: the parapet drops this far on its low side.
    const drop = d.form === 'slant' ? 3 + pitch * 0.1 : 0;
    // Tiers: [inset on the left, inset on the right, from floor]: the body steps in as it climbs,
    // or (a cantilever) stands in on one side below and overhangs it above.
    const tiers: Array<[number, number, number]> =
      d.form === 'setback' && f >= 4
        ? [[0, 0, 0], [0.12, 0.12, Math.ceil(f * 0.62)]]
        : d.form === 'stepped' && f >= 5
          ? [[0, 0, 0], [0.07, 0.07, Math.ceil(f * 0.45)], [0.14, 0.14, Math.ceil(f * 0.78)]]
          : d.form === 'cantilever' && f >= 5
            ? [d.flip ? [0.16, 0, 0] : [0, 0.16, 0], [0, 0, Math.ceil(f * 0.55)]]
            : [[0, 0, 0]];
    // The curtain wall keeps inside the narrowest tier.
    const gin = Math.max(GLAZE_IN[d.material], ...tiers.map(([l, r]) => Math.max(l, r) + 0.04));
    const gx = x + w * gin;
    const gw = w * (1 - 2 * gin);
    // A shard: one face rakes in from half way up, to a narrow top over the other.
    const rake = d.form === 'shard' && f >= 5 ? { from: roofOf(Math.ceil(f * 0.5)), narrow: 0.42 } : null;
    // Where the raked face stands at height y (the side it rakes on is `flip`'s).
    const rakeX = (y: number) => {
      if (!rake || y >= rake.from) return d.flip ? x : x + w;
      const t = (rake.from - y) / (rake.from - top);
      return d.flip ? x + w * (1 - rake.narrow) * t : x + w - w * (1 - rake.narrow) * t;
    };
    tiers.forEach(([il, ir, from], t) => {
      const to = t + 1 < tiers.length ? tiers[t + 1][2] : f;
      const yTop = t + 1 < tiers.length ? roofOf(to) + 1.5 : top + drop;
      const yBot = t === 0 ? 100 : roofOf(from) + 1.5;
      const tx = x + w * il;
      const tw = w * (1 - il - ir);
      if (rake) {
        const [a, b] = d.flip ? [rakeX(top), x + w] : [x, rakeX(top)];
        bodies[d.material] += d.flip
          ? poly([[x, yBot], [x, rake.from], [a, top], [b, top], [b, yBot]])
          : poly([[x, yBot], [x, top], [b, top], [x + w, rake.from], [x + w, yBot]]);
      } else bodies[d.material] += d.form === 'chamfer' && t + 1 === tiers.length
        ? poly([[tx, yBot], [tx, yTop + 3], [tx + tw * 0.18, yTop], [tx + tw * 0.82, yTop], [tx + tw, yTop + 3], [tx + tw, yBot]])
        : rect(tx, yTop, tw, yBot - yTop);
      faceL += rect(tx, yTop, gx - tx, yBot - yTop);
      faceR += rect(gx + gw, yTop, tx + tw - gx - gw, yBot - yTop);
    });
    // The slant itself, a wedge rising to one side.
    if (drop) {
      const [hi, lo] = d.flip ? [x, x + w] : [x + w, x];
      bodies[d.material] += `M${r1(lo)},${r1(top + drop)}L${r1(hi)},${r1(top)}L${r1(hi)},${r1(top + drop)}Z`;
    }
    // The roof a label pins to: the slant's lower edge, else the top.
    const roof = top + drop;
    // Plant screened on a few flat roofs, and an antenna on fewer.
    if (d.form === 'tower' && d.mast > 0.55) bodies[d.material] += rect(x + w * 0.22, top - 2.2, w * 0.56, 2.2);
    if ((d.form === 'slender' && d.mast < 0.45) || (d.form === 'tower' && d.mast < 0.2)) {
      const len = 3 + d.mast * 5;
      masts += `M${r1(x + w / 2)},${r1(top)}V${r1(Math.max(1, top - len))}`;
    }
    // The curtain wall: under a chamfer or a slant, a little lower than the roof.
    const gy = drop ? top + drop : top + (d.form === 'chamfer' ? 3.2 : 2.6) - pitch * 0.15;
    if (rake) {
      const inX = (y: number) => (d.flip ? Math.max(gx, rakeX(y) + w * 0.06) : Math.min(gx + gw, rakeX(y) - w * 0.06));
      glaze += d.flip
        ? poly([[gx, 100], [gx, rake.from], [inX(gy), gy], [gx + gw, gy], [gx + gw, 100]])
        : poly([[gx, 100], [gx, gy], [inX(gy), gy], [gx + gw, rake.from], [gx + gw, 100]]);
    } else glaze += rect(gx, gy, gw, 100 - gy);
    // Two mullions down the wall, in thirds.
    for (const m of [1 / 3, 2 / 3]) {
      const mx = gx + gw * m;
      const my = rake && (d.flip ? mx < rakeX(gy) : mx > rakeX(gy)) ? Math.max(gy, rake.from) : gy;
      mullions += `M${r1(mx)},${r1(my)}V100`;
    }
    // The panes: one per deploy, from the street up, each the wall's width
    // (narrower up a shard's raked face), a slab between each floor.
    const unit = (gw * 0.94) / perFloor;
    for (let fl = 0; fl < f; fl++) {
      const wy = 100 - 4 - (fl + 1) * pitch + pitch * 0.12;
      const ph = pitch * 0.76;
      // A spandrel band every fifth floor, in the slab under that floor's panes.
      if (fl % 5 === 4 && fl < f - 1 && !rake) {
        const [il, ir] = tiers.reduce((t, tt) => (fl + 1 >= tt[2] ? tt : t), tiers[0]);
        bands += rect(x + w * (il + 0.02), wy - pitch * 0.24, w * (1 - il - ir - 0.04), pitch * 0.24);
      }
      let x0 = gx + gw * 0.03;
      let span = gw * 0.94;
      if (rake && wy < rake.from) {
        const edge = d.flip ? rakeX(wy) + w * 0.08 : rakeX(wy) - w * 0.08;
        if (d.flip) {
          span = x0 + span - Math.max(x0, edge);
          x0 = Math.max(x0, edge);
        } else span = Math.min(x0 + span, edge) - x0;
      }
      const pw = span / perFloor;
      for (let c = 0; c < perFloor; c++) {
        const gap = perFloor > 1 ? Math.min(0.6, unit * 0.15) : 0;
        const pane = rect(x0 + c * pw + gap / 2, wy, Math.max(0.4, pw - gap), ph);
        const on = fl * perFloor + c < day.count;
        if (on && lamps++ % 3 === 2) lit2 += pane;
        else if (on) lit += pane;
        else dark += pane;
      }
    }
    buildings.push({ date: day.date, x: r1(x), w: r1(w), top: r1(roof), floors: f, form: d.form, material: d.material });
  });

  const near = (target: number) => buildings.reduce((b, c) => (Math.abs(c.x + c.w / 2 - target) < Math.abs(b.x + b.w / 2 - target) ? c : b));
  const share = (b: Building) => ({ x: Math.round(b.x + b.w / 2) / 1000, y: Math.round(100 - b.top) / 100 });
  const last = buildings[buildings.length - 1];
  return {
    buildings,
    bodies,
    glaze,
    mullions,
    bands,
    faceL,
    faceR,
    masts,
    lit,
    lit2,
    dark,
    today: { x: last.x, w: last.w, top: last.top },
    pin: share(near(186)),
    pin0: share(near(60)),
    perFloor,
  };
}

/* -------------------------------------------------------------- the light */

/** The city's colours at a sky: what the buildings, the far skyline and the cloud wear. */
export interface CityLight {
  /** Facades by material (blue glass, pale stone, dark metal): silhouettes at night, sunlit by day. */
  frame: [string, string, string];
  /** The curtain wall the panes sit in: always deep enough that a lit pane stands out 3:1. */
  glaze: string;
  /** A lit pane: warm lamplight at night, a glint of sun by day. */
  pane: string;
  pane2: string;
  /** The lit pane's edge: none at night, the site's orange round a daytime glint so it never reads as sky. */
  paneEdge: string;
  /** An unlit pane, rgba(): a faint reflection, never mistaken for a lit one. */
  unlit: string;
  /** The mullions and the spandrel bands, rgba() and #rrggbb. */
  mullion: string;
  band: string;
  /** The far skyline's near and farther ranges: darker than the haze, paler with distance. */
  near: string;
  far: string;
  /** The near range while its label is open: darker against a daytime sky, so lighting up still means more contrast. */
  nearOn: string;
  /** How strongly the sun lights the faces turned to it, how deep the shade is on the others, and the shade's colour. */
  sunFace: number;
  shade: number;
  shadeFill: string;
  /** The cloud's body, its fill (the wait to the next think), the fill's top edge and its outline. */
  cloud: string;
  cloudFill: string;
  cloudLine: string;
  cloudRim: string;
}

const NIGHT_FRAME: [string, string, string] = ['#0e121a', '#13110f', '#0b0d12'];
const DAY_FRAME: [string, string, string] = ['#6f9cc8', '#c9bfae', '#5b7392'];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The city at a sky. Pure, and tested at every degree (place-city.test.ts). */
export function cityLight(s: Sky): CityLight {
  const d = s.daylight;
  const warm = s.warmth;
  // How far the street has turned from lamplit silhouettes to sunlit glass and stone.
  const lit = smooth(0.45, 0.8, d);
  const frame = NIGHT_FRAME.map((c, i) => mix(mix(c, DAY_FRAME[i], lit), s.sun, warm * 0.28 * Math.min(1, d * 2))) as [string, string, string];
  const glaze = mix(mix('#07090e', '#4b7aab', lit), '#3a2630', warm * 0.35 * Math.min(1, d * 2));
  // The skyline's own haze, opaque, for the far ranges to fade into.
  const horizon = over(s.haze, s.low);
  const day = s.tone === 'light';
  // What the ranges are made of before the haze takes them: night ink, or a
  // blue-grey shadow on the daytime sky.
  const ink = mix(s.low, day ? '#1f3d64' : '#03050a', 0.55);
  // Backlit by a low sun, the near range stands darker against the glow.
  const near = mix(ink, horizon, 0.2 + 0.24 * d * (1 - 0.6 * warm));
  return {
    frame,
    glaze,
    pane: mix('#f5bd6e', '#ffefcf', lit),
    pane2: mix('#fbe0aa', '#fffaf0', lit),
    paneEdge: lit > 0.5 ? 'rgba(208,138,58,0.5)' : 'none',
    unlit: lit > 0.5 ? 'rgba(206,226,246,0.22)' : 'rgba(237,228,212,0.08)',
    mullion: lit > 0.5 ? 'rgba(232,242,252,0.42)' : 'rgba(237,228,212,0.1)',
    band: mix(frame[0], lit > 0.5 ? '#e8eef4' : '#2a2e36', 0.35),
    near,
    far: mix(ink, horizon, 0.46 + 0.36 * d),
    nearOn: day ? mix(near, '#25405e', 0.62) : near,
    sunFace: s.sunUp ? r2(0.14 + 0.62 * warm) : 0,
    shade: r2(0.46 * d),
    shadeFill: mix('#000000', '#3e5d82', lit),
    // A cloud is ink at night and a slate underside in the low light, warmed at
    // the turn of the day; on the daytime sky it is white, its fill the petrol.
    cloud: day ? '#dfe9f2' : mix(mix('#0f1213', '#3b5268', d), '#6a4058', warm * 0.4),
    cloudFill: day ? '#3f7f88' : mix('#4f7d82', '#94c8ce', d),
    cloudLine: day ? '#173f46' : mix('#bfe3e7', '#eef9fa', d),
    cloudRim: day ? '#5a7a96' : '#7fb8c0',
  };
}

/** The city's light as CSS custom properties (--city-*), set beside skyVars on the hero. */
export function cityVars(c: CityLight): string {
  return [
    `--city-glass:${c.frame[0]}`,
    `--city-stone:${c.frame[1]}`,
    `--city-metal:${c.frame[2]}`,
    `--city-glaze:${c.glaze}`,
    `--city-pane:${c.pane}`,
    `--city-pane2:${c.pane2}`,
    `--city-pane-edge:${c.paneEdge}`,
    `--city-unlit:${c.unlit}`,
    `--city-mullion:${c.mullion}`,
    `--city-band:${c.band}`,
    `--city-near:${c.near}`,
    `--city-near-on:${c.nearOn}`,
    `--city-far:${c.far}`,
    `--city-sunface:${c.sunFace}`,
    `--city-shade:${c.shade}`,
    `--city-shade-fill:${c.shadeFill}`,
    `--city-cloud:${c.cloud}`,
    `--city-cloud-fill:${c.cloudFill}`,
    `--city-cloud-line:${c.cloudLine}`,
    `--city-cloud-rim:${c.cloudRim}`,
  ].join(';');
}

/** WCAG contrast between two opaque #rrggbb colours. */
export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}
