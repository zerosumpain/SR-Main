// showcase-city.ts — the city the place view's showcase walks down through:
// the towers behind each chapter, the sky over each, and the colours they
// all take in the owner's light.
//
// The showcase's chapters (showcase-place.ts) are drawn in front of a street
// of glass and concrete towers. Nothing in a tower is data: the towers are
// scenery, seeded so every load draws the same street. What changes is the
// light, and that comes only from the hero's sky (sky.ts) and the sun's
// altitude, so the walk down the page is lit by the same sun:
//
//   night      a navy sky with the city's sodium glow along the skyline, ink
//              towers, ribbon windows lit warm, the panes that ARE data (the
//              app's doorways) lamp-orange
//   blue hour  the sky deep blue, the glow along the skyline rose or violet
//   low sun    a gold glow behind the towers, the sunlit faces warm, a gold
//              glint down every sun-side edge, the shadows long
//   day        a cobalt sky, a pale haze behind the towers, the far street
//              lighter (air between), blue glass with a sunlit face and a
//              sheen of sky, short shadows on a pale pavement
//
// Contrast. Type sits on two kinds of thing: the chapter skies and the
// surfaces (a tower's glass, the pavement, a deck). Both are held at or under
// a ceiling that rises with the daylight (ceiling(), CAP_NIGHT to CAP_DAY),
// and every tone type takes is lifted with it (`tone`: the site's on-dark
// orange, petrol and green, a shade lighter by day, as the hero's are), so
// cream at 86% and every tone keep 4.5:1 at every degree, with a tower's
// hairline outline across them too. What is lighter than the ceiling (the
// skyline glow, a sunlit face, a glint, a landmark's lantern, a lit window) is drawn only where no type stands: off the copy column (`dark`
// stretches, and the text-safe mask PlaceShowcase's scenes draw: column(),
// SafeMask.svelte) and out of every label's box (quietBoxes). showcase-city
// .test.ts checks every degree, rising and setting.
//
// Pure: a sky and an altitude in, numbers, path strings and colours out.

import { luminance, mix, type Sky } from './sky';
import { labelBox, seeded, type Box } from './showcase-place';

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

/** The ceiling on anything type can sit on after dark: a shade under the sky.ts street ceiling, for the hairline. */
export const CAP_NIGHT = 0.021;
/** And in full day: a cobalt sky deep enough for cream at 86% and the lightened tones, a hairline across them too. */
export const CAP_DAY = 0.045;
/** Surfaces sit a shade under the sky's ceiling, so a tower reads against the sky behind it. */
const SURFACE_SHARE = 0.88;

/** The ceiling at a daylight (0 night .. 1 full day). */
export function ceiling(daylight: number): number {
  return CAP_NIGHT + (CAP_DAY - CAP_NIGHT) * clamp(daylight, 0, 1);
}

/** The most any near surface type may sit on can be, at its brightest (full day); the far street may reach the ceiling. */
export const SURFACE_LUM = CAP_DAY * SURFACE_SHARE;

/** Deepened toward black until its luminance is at most `max`, keeping its hue. */
export function capLum(c: string, max = SURFACE_LUM): string {
  if (luminance(c) <= max) return c;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 18; k++) {
    const m = (lo + hi) / 2;
    if (luminance(mix(c, '#000000', m)) > max) lo = m;
    else hi = m;
  }
  return mix(c, '#000000', hi);
}

/**
 * How golden the low sun is, 0..1: up from just under the skyline, full from
 * about 1° to 9°, gone by 16°. The sky's own `warmth` is a twilight measure,
 * gone by the time the light is gold; this one peaks where golden hour does.
 */
export function goldAt(alt: number): number {
  return r2(smooth(-5, 1, alt) * (1 - smooth(9, 16, alt)));
}

/* ------------------------------------------------------------- the palette */

/** [night, day] for every surface. */
const SURFACES = {
  /** The far street, a layer back. */
  far: ['#0e121b', '#2e5182'],
  /** A near tower's glass. */
  body: ['#0c1018', '#1f3a62'],
  /** A tower's faces, turned from the street. */
  shade: ['#080b11', '#132842'],
  /** The glass of a lower window band. */
  glass: ['#0d121b', '#2b4f80'],
  /** Concrete: the walkway's deck, a slab, a site cabin. */
  deck: ['#15171b', '#3a4452'],
  /** The street the chapters stand on. */
  ground: ['#0c0d10', '#2e3a48'],
  /** The next think's cloud. */
  cloud: ['#0f1213', '#2c4a72'],
  /** The moon's unlit disc, the sky through it by day. */
  disc: ['#0e1112', '#2a4c7e'],
} as const;

export type Surface = keyof typeof SURFACES;

/** The four chapters, each with its own street and a hint of its own sky. */
export type Chapter = 'observatory' | 'walk' | 'house' | 'works';
/** A chapter's own hue, a tint over the owner's sky: never more than an eighth of it. */
const TINT: Record<Chapter, string> = {
  observatory: '#0a2a66',
  walk: '#16382c',
  house: '#4a2a1c',
  works: '#24323e',
};
const TINT_SHARE = 0.12;

/**
 * The deep sky the showcase's chapters stand in: [altitude, middle, low] and,
 * where dusk differs from dawn, the setting pair. The hero's own sky turns
 * pale with ink type from golden hour up; the showcase keeps cream type, so it
 * carries its own deep version of the same light (the hero's deep stops, on
 * up through a cobalt day), and the ceiling holds it for the type.
 */
const DEEP: Array<[number, string, string, string?, string?]> = [
  [-24, '#080b17', '#0e1222'],
  [-15, '#0a1022', '#121a33'],
  [-9, '#0d1838', '#17244a'],
  [-5, '#112458', '#1b2d64', '#122256', '#222a62'],
  [-2, '#182b66', '#33326c', '#1c2862', '#3e2c62'],
  [1, '#26346e', '#4e3a62', '#2e2f69', '#5a3352'],
  [6, '#24407a', '#47466e', '#2a3c74', '#53405e'],
  [14, '#1d4580', '#294a78'],
  [32, '#17468a', '#22497e'],
  [60, '#13458f', '#1f4a83'],
];

/** The deep sky's middle and low stops at an altitude, climbing or sinking. */
export function deepSky(alt: number, rising: boolean): [mid: string, low: string] {
  const pick = (k: (typeof DEEP)[number]): [string, string] => (!rising && k[3] && k[4] ? [k[3], k[4]] : [k[1], k[2]]);
  if (alt <= DEEP[0][0]) return pick(DEEP[0]);
  let i = 0;
  while (i < DEEP.length - 1 && alt >= DEEP[i + 1][0]) i++;
  if (i === DEEP.length - 1) return pick(DEEP[i]);
  const t = (alt - DEEP[i][0]) / (DEEP[i + 1][0] - DEEP[i][0]);
  const [a0, a1] = pick(DEEP[i]);
  const [b0, b1] = pick(DEEP[i + 1]);
  return [mix(a0, b0, t), mix(a1, b1, t)];
}

/** The site's on-dark tones and their daytime shades (the hero's accent and accentInk, and a lighter good green). */
const TONES = {
  accent: ['#e8863a', '#f4b270'],
  ink: ['#7fb8c0', '#a3d2d8'],
  good: ['#9aaa68', '#b4c47e'],
} as const;

export interface CityLight {
  /** How far up the ceiling stands now. */
  cap: number;
  /** Every surface, #rrggbb, at or under the surfaces' share of the ceiling. */
  surface: Record<Surface, string>;
  /** Each chapter's sky: from the top of the chapter (`top`) down to the skyline (`low`), #rrggbb, under the ceiling. */
  chapters: Record<Chapter, { top: string; low: string }>;
  /** The tones type takes, lightened with the ceiling. */
  tone: Record<keyof typeof TONES, string>;
  /** The glow along the skyline, behind the towers: rgba(); sodium at night, rose in the blue hour, gold low, pale by day. */
  haze: string;
  /** The light on a sunlit face, #rrggbb, and how strongly it shows, 0..1 (none with the sun down). */
  sunlit: string;
  sunOn: number;
  /** The sky's sheen down the glass, and how much. */
  sheenOn: number;
  /** A pane that is data (a doorway): lamp-orange at night, gold in a low sun, sky-pale glass by day. */
  pane: string;
  pane2: string;
  /** The moon: cream at night, a pale cool disc by day. */
  moon: string;
  /** The sun's own colour for a glint down a sun-side edge. */
  glint: string;
  /** How strongly a sun-side edge glints, 0..1: most with the sun low, none with it down. */
  glintOn: number;
  /** How dark a cast shadow on the street is, 0..1. */
  shadow: number;
  /** How far a shadow runs, in scene units per unit of a tower's width. */
  reach: number;
  /** A tower's hairline outline, rgba(): fainter by day, when the glass reads against the sky on its own. */
  edge: string;
}

const PANE: [string, string] = ['#f0a24e', '#a9cce0'];
const PANE2: [string, string] = ['#f6cf8a', '#d2e5ef'];
const CREAM = '237,228,212';

/** Lamp to glass, by way of the sun's gold when it is low: never through a grey middle. */
function paneAt(lamp: string, glass: string, sun: string, p: number, gold: number): string {
  const mid = mix(mix(lamp, glass, 0.5), sun, 0.25 + 0.6 * gold);
  return p < 0.5 ? mix(lamp, mid, p * 2) : mix(mid, glass, p * 2 - 1);
}

function rgbaOf(s: string): number[] {
  return s.match(/[\d.]+/g)!.map(Number);
}

/** The city in a sky's light, the sun `alt` degrees up (the same altitude the sky was drawn for). */
export function cityLight(sky: Sky, alt: number): CityLight {
  const d = clamp(sky.daylight, 0, 1);
  const gold = sky.sunUp ? goldAt(alt) : goldAt(Math.min(alt, -1));
  const cap = ceiling(d);
  const scap = cap * SURFACE_SHARE;
  // The far street stands at the ceiling itself, paled toward the sky by the air between.
  const surface = Object.fromEntries(
    (Object.keys(SURFACES) as Surface[]).map((k) => [k, capLum(mix(SURFACES[k][0], SURFACES[k][1], d), k === 'far' ? cap : scap)]),
  ) as Record<Surface, string>;
  // The chapter skies: the owner's own light in its deep version (deepSky:
  // its middle at the top of a chapter, the sky over the skyline at its
  // foot, gilded with a low sun),
  // a little of the chapter's hue in it, held under the ceiling.
  const [deepMid, deepLow] = deepSky(alt, sky.side === 'east');
  const low = mix(deepLow, sky.sun, 0.22 * gold);
  const chapters = Object.fromEntries(
    (Object.keys(TINT) as Chapter[]).map((k) => [
      k,
      { top: capLum(mix(deepMid, TINT[k], TINT_SHARE), cap), low: capLum(mix(low, TINT[k], TINT_SHARE * 0.8), cap) },
    ]),
  ) as Record<Chapter, { top: string; low: string }>;
  // The lightest stop anything stands on decides how far the tones lighten, as the hero's do.
  const lightest = Math.max(...Object.values(chapters).flatMap((c) => [luminance(c.top), luminance(c.low)]), ...Object.values(surface).map((c) => luminance(c)));
  const k = clamp((lightest - 0.012) / (CAP_DAY - 0.012), 0, 1);
  const tone = Object.fromEntries(
    (Object.keys(TONES) as Array<keyof typeof TONES>).map((t) => [t, mix(TONES[t][0], TONES[t][1], k)]),
  ) as Record<keyof typeof TONES, string>;
  // The skyline's glow: the sky's own haze, gilded with a low sun, a little stronger then.
  const [hr, hg, hb, ha] = rgbaOf(sky.haze);
  const sunRgb = rgb(sky.sun);
  const hz = [hr, hg, hb].map((v, i) => Math.round(v + (sunRgb[i] - v) * 0.45 * gold));
  const haze = `rgba(${hz.join(',')},${r2(clamp(ha * (1.3 - 0.4 * d + 0.4 * gold), 0, 0.8))})`;
  // The sunlit face: pale glass in a high sun, the sun's gold in a low one.
  const sunlit = mix('#cfe0ec', sky.sun, 0.25 + 0.6 * gold);
  const sunOn = sky.sunUp ? r2(0.1 + 0.16 * d + 0.18 * gold) : 0;
  // Panes ease from lamp to glass over the middle of the change, so twilight keeps them lamps.
  const p = clamp((d - 0.35) / 0.4, 0, 1);
  return {
    cap: Math.round(cap * 10000) / 10000,
    surface,
    chapters,
    tone,
    haze,
    sunlit,
    sunOn,
    sheenOn: r2(0.12 * d),
    pane: paneAt(PANE[0], PANE[1], sky.sun, p, gold),
    pane2: paneAt(PANE2[0], PANE2[1], sky.sun, p, gold),
    moon: mix('#efe6d6', '#dde7f0', d),
    glint: sky.sun,
    glintOn: sky.sunUp ? r2(clamp(0.2 * d + 0.8 * gold, 0, 1)) : 0,
    shadow: sky.sunUp ? r2(d * 0.5) : 0,
    reach: sky.sunUp ? r1(0.3 + 2.2 * (1 - sky.sunY) ** 2) : 0,
    edge: `rgba(${CREAM},${r2(0.1 - 0.04 * d)})`,
  };
}

/**
 * The city's light as CSS custom properties: --city-<surface>, the chapter
 * skies (--city-sky-<chapter>-top/-low), the tones the showcase's type takes
 * (written over the site's own --accent-on-dark, --accent-ink-on-dark and
 * --good-on-dark inside the showcase, so every label lightens with the day),
 * and the light's marks (--city-haze, --city-sunlit, --city-sun-on, …).
 */
export function cityVars(c: CityLight): string {
  return [
    ...Object.entries(c.surface).map(([k, v]) => `--city-${k}:${v}`),
    ...Object.entries(c.chapters).flatMap(([k, v]) => [`--city-sky-${k}-top:${v.top}`, `--city-sky-${k}-low:${v.low}`]),
    `--accent-on-dark:${c.tone.accent}`,
    `--accent-ink-on-dark:${c.tone.ink}`,
    `--good-on-dark:${c.tone.good}`,
    `--city-haze:${c.haze}`,
    `--city-sunlit:${c.sunlit}`,
    `--city-sun-on:${c.sunOn}`,
    `--city-sheen-on:${c.sheenOn}`,
    `--city-pane:${c.pane}`,
    `--city-pane2:${c.pane2}`,
    `--city-moon:${c.moon}`,
    `--city-glint:${c.glint}`,
    `--city-glint-on:${c.glintOn}`,
    `--city-shadow:${c.shadow}`,
    `--city-edge:${c.edge}`,
  ].join(';');
}

/**
 * The copy column on a desktop, in a scene's units: the heading and the plate
 * stand in the scene's own sky on one side (PlaceScene's --col, a third of
 * the measure or a shade more), and nothing lighter than the ceiling may be
 * drawn there. `fade` is the soft edge the light comes back over.
 */
export function column(side: 'l' | 'r'): { from: number; to: number; fade: number } {
  return side === 'l' ? { from: -4000, to: 362, fade: 110 } : { from: 638, to: 5000, fade: 110 };
}

/* -------------------------------------------------------------- the towers */

export interface Tower {
  x: number;
  w: number;
  /** Where the roof is, down the scene. */
  top: number;
  /** The silhouette: a slab, a setback, a slanted or chamfered crown, a mast. */
  d: string;
}

export interface Skyline {
  towers: Tower[];
  /** Ribbon windows lit after dark (scenery, not data). */
  lit: string;
  /** The floor lines of the curtain walls. */
  floors: string;
  /** Each tower's left and right faces, as strips, shaded. */
  faceL: string;
  faceR: string;
  /** The same faces where the sun may light them (none on a tower standing in a dark stretch). */
  sunL: string;
  sunR: string;
  /** Each tower's left and right edges, for the glint on the sun's side (none in a dark stretch). */
  edgeL: string;
  edgeR: string;
  /** A sheen of sky down each tower's glass (none in a dark stretch). */
  sheen: string;
  /** The street's own detail: a curtain wall's mullions, a block of flats' balconies. */
  detail: string;
}

/**
 * The kind of street: `glass` (tall curtain walls, chamfered and slanted
 * crowns, close mullions), `park` (lower blocks set wide apart, plain fronts),
 * `flats` (mid-rise slabs, a balcony on every floor), `mixed` (all sorts).
 */
export type Street = 'glass' | 'park' | 'flats' | 'mixed';

/** How likely each crown is on a street: [slab, setback, slanted, chamfered], the rest a mast. */
const CROWNS: Record<Street, [number, number, number, number]> = {
  glass: [0.18, 0.4, 0.62, 0.9],
  park: [0.5, 0.78, 0.9, 0.96],
  flats: [0.62, 0.84, 0.94, 0.97],
  mixed: [0.36, 0.6, 0.8, 0.88],
};

export interface SkylineOptions {
  seed: number;
  /** Across the scene, from and to (towers run past the picture's edges for a wide screen). */
  from: number;
  to: number;
  /** The street, down the scene. */
  base: number;
  /** Towers' heights, least and most. */
  lo: number;
  hi: number;
  /** Towers' widths, least and most. */
  wide?: [number, number];
  /** Gaps between towers, least and most. */
  gap?: [number, number];
  /** The kind of street (default mixed). */
  street?: Street;
  /** Stretches of the street kept clear of towers, [from, to]. */
  clear?: Array<[number, number]>;
  /** Stretches where towers are lower, [from, to, most height]: under a heading or the moon. */
  low?: Array<[number, number, number]>;
  /** Stretches behind the type, [from, to]: no window lit, no sunlit face, sheen or glint. */
  dark?: Array<[number, number]>;
  /** About how many of a tower's floors carry a lit run of windows. */
  litShare?: number;
  /** Boxes where no window is lit: where the labels' words stand, and the charts. The street itself doesn't change. */
  quiet?: Box[];
}

const overlaps = (a0: number, a1: number, [b0, b1]: [number, number] | [number, number, number]) => a0 < b1 && a1 > b0;

/** A seeded street of towers between `from` and `to`, standing on `base`. */
export function skyline(o: SkylineOptions): Skyline {
  const rnd = seeded(o.seed);
  const [w0, w1] = o.wide ?? [34, 86];
  const [g0, g1] = o.gap ?? [4, 26];
  const street = o.street ?? 'mixed';
  const [cSlab, cStep, cSlant, cChamfer] = CROWNS[street];
  const pitch = street === 'flats' ? 10 : street === 'park' ? 11 : 9;
  const out: Skyline = { towers: [], lit: '', floors: '', faceL: '', faceR: '', sunL: '', sunR: '', edgeL: '', edgeR: '', sheen: '', detail: '' };
  let x = o.from;
  while (x < o.to) {
    const w = Math.round(w0 + rnd() * (w1 - w0));
    const blocked = o.clear?.find((c) => overlaps(x, x + w, c));
    if (blocked) {
      x = blocked[1] + Math.round(g0 + rnd() * (g1 - g0));
      continue;
    }
    let h = o.lo + rnd() * (o.hi - o.lo);
    for (const l of o.low ?? []) if (overlaps(x, x + w, l)) h = Math.min(h, l[2] * (0.7 + 0.3 * rnd()));
    h = Math.max(12, Math.round(h));
    const top = o.base - h;
    const kind = rnd();
    const B = o.base;
    let d: string;
    let crown = 0;
    if (kind < cSlab || h < 60) d = `M${x},${B}V${top}H${x + w}V${B}Z`;
    else if (kind < cStep) {
      // A setback: the upper floors stepped in.
      const step = Math.round(top + h * 0.28);
      const inset = Math.round(w * 0.18);
      d = `M${x},${B}V${step}H${x + inset}V${top}H${x + w - inset}V${step}H${x + w}V${B}Z`;
    } else if (kind < cSlant) {
      // A slanted crown.
      const rise = Math.round(Math.min(26, w * 0.45));
      crown = rise;
      d = rnd() < 0.5 ? `M${x},${B}V${top + rise}L${x + w},${top}V${B}Z` : `M${x},${B}V${top}L${x + w},${top + rise}V${B}Z`;
    } else if (kind < cChamfer) {
      // A chamfered crown: both top corners cut.
      const c = Math.round(Math.min(14, w * 0.22));
      crown = c;
      d = `M${x},${B}V${top + c}L${x + c},${top}H${x + w - c}L${x + w},${top + c}V${B}Z`;
    } else {
      // A mast on the roof.
      const m = Math.round(x + w * (0.3 + rnd() * 0.4));
      d = `M${x},${B}V${top}H${m - 1}V${top - 22}H${m + 1}V${top}H${x + w}V${B}Z`;
    }
    out.towers.push({ x, w, top, d });
    const face = Math.max(3, Math.round(w * 0.16));
    const roof = top + (crown ? crown + 2 : 0);
    const dark = o.dark?.some((c) => overlaps(x, x + w, c));
    out.faceL += `M${x},${B}V${roof}h${face}V${B}Z`;
    out.faceR += `M${x + w - face},${B}V${roof}h${face}V${B}Z`;
    if (!dark) {
      out.sunL += `M${x},${B}V${roof}h${face}V${B}Z`;
      out.sunR += `M${x + w - face},${B}V${roof}h${face}V${B}Z`;
      out.edgeL += `M${x + 0.5},${B}V${roof}`;
      out.edgeR += `M${x + w - 0.5},${B}V${roof}`;
    }
    // A sheen: a slanting band of sky down the glass, between the faces.
    const s0 = x + face + Math.round(rnd() * (w - 3 * face) * 0.5);
    const sw = Math.max(3, Math.round((w - 2 * face) * 0.28));
    if (!dark && w - 2 * face > 8) out.sheen += `M${s0},${roof + 6}h${sw}L${s0 + sw - 6},${B}h${-sw}Z`;
    // The street's detail: a curtain wall's mullions, or a balcony slab on every floor of the flats.
    if (street === 'glass' && w - 2 * face > 12) for (let mx = x + face + 6; mx < x + w - face - 3; mx += 6) out.detail += `M${mx},${roof + 4}V${B}`;
    if (street === 'flats' && h > 40) for (let y = roof + pitch; y < B - 6; y += pitch) out.detail += `M${x + face - 2},${y + pitch - 2}h${w - 2 * face + 4}`;
    // Floors, and a lit run on some of them after dark.
    for (let y = roof + pitch; y < B - 4; y += pitch) {
      out.floors += `M${x + face},${y}H${x + w - face}`;
      if (!dark && rnd() < (o.litShare ?? 0.24)) {
        const span = w - 2 * face - 4;
        const run = Math.max(3, Math.round(span * (0.15 + rnd() * 0.5)));
        const at = x + face + 2 + Math.round(rnd() * Math.max(0, span - run));
        const hush = o.quiet?.some((q) => at < q.x + q.w && at + run > q.x && y + 2 < q.y + q.h && y + 5.4 > q.y);
        if (!hush) out.lit += `M${at},${y + 2}h${run}v3.4h${-run}Z`;
      }
    }
    x += w + Math.round(g0 + rnd() * (g1 - g0));
  }
  return out;
}

/* ------------------------------------------------------------ the landmarks */

/** One modern landmark a chapter: a tapered spire, a diagrid, a lit crown. */
export type LandmarkKind = 'taper' | 'diagrid' | 'crown';

export interface Landmark {
  x: number;
  w: number;
  top: number;
  /** The silhouette. */
  d: string;
  /** Its structure, drawn faint over the glass: the taper's fins, the diagrid's diamonds, the crown's frame. */
  marks: string;
  /** The part lit after dark (the crown's lantern, the spire's beacon), or ''. */
  glow: string;
}

/** A landmark tower `w` wide standing `h` tall on `base` from `x`. Scenery, not data. */
export function landmark(kind: LandmarkKind, x: number, w: number, h: number, base: number): Landmark {
  const top = base - h;
  const R = x + w;
  if (kind === 'taper') {
    // Narrowing as it climbs to a spire: the fins converge with it.
    const sh = Math.round(top + h * 0.1);
    const d = `M${x},${base}L${r1(x + w * 0.22)},${sh}L${r1(x + w * 0.5)},${top}L${r1(R - w * 0.22)},${sh}L${R},${base}Z`;
    let marks = '';
    for (let k = 1; k < 6; k++) {
      const f = k / 6;
      marks += `M${r1(x + w * f)},${base}L${r1(x + w * 0.22 + w * 0.56 * f)},${sh}`;
    }
    for (let y = base - 26; y > sh + 8; y -= 26) {
      const t = (base - y) / (base - sh);
      marks += `M${r1(x + w * 0.22 * t)},${y}H${r1(R - w * 0.22 * t)}`;
    }
    return { x, w, top, d, marks, glow: `M${r1(x + w * 0.5 - 1.5)},${top + 8}h3v10h-3Z` };
  }
  if (kind === 'diagrid') {
    // A square-cut tower in a lattice of diamonds, its top corners chamfered.
    const c = Math.round(w * 0.18);
    const d = `M${x},${base}V${top + c}L${x + c},${top}H${R - c}L${R},${top + c}V${base}Z`;
    const step = Math.round(w / 3);
    let marks = '';
    for (let y = top + c; y < base - 2; y += step * 2) {
      const y2 = Math.min(base, y + step * 2);
      for (let k = 0; k < 3; k++) {
        const a = x + k * step;
        marks += `M${a},${y}L${a + step},${y2}M${a + step},${y}L${a},${y2}`;
      }
    }
    return { x, w, top, d, marks, glow: '' };
  }
  // A slab with a lantern on top: an open frame lit after dark.
  const lantern = Math.round(Math.min(34, h * 0.14));
  const d = `M${x},${base}V${top + lantern}H${x + 4}V${top}H${R - 4}V${top + lantern}H${R}V${base}Z`;
  let marks = `M${x},${top + lantern}H${R}`;
  for (let k = 1; k < 4; k++) marks += `M${r1(x + 4 + ((w - 8) * k) / 4)},${top}V${top + lantern}`;
  // The lantern's glass, bay by bay between the frame's posts.
  const bay = (w - 8) / 4;
  let glow = '';
  for (let k = 0; k < 4; k++) glow += `M${r1(x + 4 + bay * k + 2)},${top + 4}h${r1(bay - 4)}v${lantern - 8}h${r1(-(bay - 4))}Z`;
  return { x, w, top, d, marks, glow };
}

/**
 * Each tower's shadow on the street: a band across the pavement running away
 * from the sun (to the right while it climbs in the east), longer the lower it
 * stands. Empty with the sun down.
 */
export function shadows(towers: Tower[], side: 'east' | 'west', reach: number, base: number, depth = 10): string {
  if (!(reach > 0)) return '';
  const k = side === 'east' ? 1 : -1;
  return towers
    .map((t) => {
      const run = r1(Math.min(220, t.w * reach));
      const a = side === 'east' ? t.x : t.x + t.w;
      const b = side === 'east' ? t.x + t.w : t.x;
      return `M${a},${base}L${b},${base}L${r1(b + k * run)},${base + depth}L${r1(a + k * run * 0.6)},${base + depth}Z`;
    })
    .join('');
}

/* -------------------------------------------------------- the office block */

/**
 * Every cell of a block of `n` windows laid out `cols` across, as windows()
 * in showcase-place lays out the lit ones: the full grid, so the panes still
 * to light stand dark beside the lit ones.
 */
export function windowGrid(n: number | null | undefined, cols: number, box: { x: number; y: number; w: number; h: number }): string {
  const count = Math.max(0, Math.round(n ?? 0));
  if (!count) return '';
  const rows = Math.ceil(count / cols);
  const px = box.w / cols;
  const py = box.h / rows;
  const w = r1(px * 0.56);
  const h = r1(Math.min(py * 0.58, w * 1.5));
  let d = '';
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) d += `M${r1(box.x + c * px + (px - w) / 2)},${r1(box.y + r * py + (py - h) / 2)}h${w}v${h}h${-w}Z`;
  return d;
}

/** The smallest box holding all of `boxes`. */
function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/**
 * Where a scene's labels stand, as boxes the towers keep their windows dark
 * in and the scene's light keeps out of, so nothing lighter than the ceiling
 * sits behind the words: each label's box on a desktop and, where it pins
 * differently there, on a tablet. A leader is so many pixels, so the label
 * stands at a different height in the scene's units at every width: each box
 * covers it from a small desktop's scale (about 1px a unit) to a wide
 * tablet's cropped picture (1.5). Generous, since a label's second line can run long.
 */
export function quietBoxes(
  pins: Array<{ x: number; y: number; lead: number; dir?: 'up' | 'down' | 'side'; hang: 'l' | 'r'; narrow?: { x?: number; y?: number; lead?: number } }>,
): Box[] {
  const at = (p: Parameters<typeof labelBox>[0]) => union([labelBox(p, 250, 96, 1), labelBox(p, 250, 96, 1.6)]);
  return pins.flatMap((p) => {
    const box = at(p);
    if (!p.narrow) return [box];
    return [box, at({ ...p, x: p.narrow.x ?? p.x, y: p.narrow.y ?? p.y, lead: p.narrow.lead ?? p.lead })];
  });
}
