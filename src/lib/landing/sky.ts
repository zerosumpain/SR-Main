// sky.ts — the place view's sky: the light at a sun altitude, drawn the way a
// city sky looks, and a small light model the scenery reads from it.
//
// The sun's altitude (whole degrees, from wherever the owner is; see ./sun)
// and whether it is climbing are all this takes. Nothing here knows where.
//
//   night         below -18°   navy ink, every star, a low amber skyglow off the city
//   dawn / dusk   -18° to -6°  stars thinning, a thin cool band along the skyline
//   blue hour     -6° to -2°   a saturated deep blue, the first (or last) rose low down
//   sunrise/set   -2° to +4°   amber and rose along the skyline under a cooler zenith;
//                              a sunrise runs paler and golder, a sunset redder
//   golden hour   +4° to +12°  low warm light, the haze turning gold
//   daylight      above +12°   a clear blue, palest at the skyline, a fuller
//                              cobalt overhead as the sun climbs toward 60°
//
// Type changes tone once, at DAY_TONE_ALT (8°, climbing or sinking): under it
// the sky is deep and type sits on it in cream; from it up the sky is a pale
// daytime blue and type turns ink (`tone`). One step, no blend between the two
// palettes, so no altitude leaves type half way between them. The dark stops
// stay under TEXT_LUM for cream; the light ones stay over DAY_LUM for ink and
// the day accents. `haze` is a band along the skyline, BEHIND the buildings,
// where no text sits, and may be as bright as the real horizon. The two on-sky
// accents (`accent`, `accentInk`) are the tone's own: the site's on-dark orange
// and petrol at night, a shade lighter in the golden light, and deep burnt
// orange and petrol on the daytime blue. place.test.ts checks every stop at
// every degree, rising and setting.
//
// Pure: numbers in, colours out, so the server and the browser paint one sky.

import { clamp, daylightAt, groundAt, hex, mix, r2, smooth, toHex } from './sky-ground';

export { mix };

/** Relative luminance (WCAG) of an #rrggbb colour. */
export function luminance(c: string | number[]): number {
  const v = typeof c === 'string' ? hex(c) : c;
  const f = (x: number) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(v[0]) + 0.7152 * f(v[1]) + 0.0722 * f(v[2]);
}

/** An rgba() colour composited over an opaque #rrggbb one. */
export function over(rgba: string, bg: string): string {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (!m) return bg;
  const a = Number(m[4]);
  const B = hex(bg);
  return toHex([1, 2, 3].map((k, i) => Number(m[k]) * a + B[i] * (1 - a)));
}

/* ------------------------------------------------------------- the stops */

/** Zenith, middle, the sky just above the skyline (all three carry type), and the skyline's haze. */
type Stops = [top: string, mid: string, low: string, haze: string];

// Keyed by altitude. Where the light differs by direction the key carries a
// rising stop and a setting one; elsewhere one serves both. Tuned by eye in the
// site's family (ink, paper, the burnt orange, the petrol), and by the test:
// every text stop keeps cream at 72% and the on-sky accents over 4.5:1.
const KEYS: Array<{ alt: number; rise: Stops; set?: Stops }> = [
  // Deep night: navy ink, the city's sodium skyglow low down.
  { alt: -24, rise: ['#05070e', '#080b17', '#0e1222', 'rgba(176,112,72,0.16)'] },
  // Astronomical twilight: the night lifting, a cool band starting.
  { alt: -15, rise: ['#060a17', '#0a1022', '#121a33', 'rgba(104,124,170,0.26)'] },
  // Nautical twilight: the first blue.
  { alt: -9, rise: ['#08102a', '#0d1838', '#17244a', 'rgba(118,138,190,0.26)'] },
  // Blue hour: saturated, deep.
  {
    alt: -5,
    rise: ['#0b1940', '#112458', '#1b2d64', 'rgba(170,160,206,0.32)'],
    set: ['#0b1840', '#122256', '#222a62', 'rgba(184,140,190,0.34)'],
  },
  // Just under the horizon: the first colour low down.
  {
    alt: -2,
    rise: ['#0d1f4d', '#182b66', '#33326c', 'rgba(232,160,138,0.44)'],
    set: ['#0d1d4a', '#1c2862', '#3e2c62', 'rgba(228,118,104,0.48)'],
  },
  // The sun on the skyline: amber and rose under a cooler zenith.
  {
    alt: 1,
    rise: ['#10275a', '#26346e', '#4e3a62', 'rgba(250,184,120,0.62)'],
    set: ['#11245a', '#2e2f69', '#5a3352', 'rgba(242,128,70,0.66)'],
  },
  // Golden hour: a warmer, brighter low sky.
  {
    alt: 6,
    rise: ['#132f6c', '#2a3e78', '#5a4668', 'rgba(255,196,120,0.7)'],
    set: ['#132c68', '#2a3c74', '#53405e', 'rgba(248,170,96,0.62)'],
  },
  // Daylight: a clear blue, the haze pale.
  { alt: 14, rise: ['#143a80', '#1d4580', '#294a78', 'rgba(206,222,230,0.58)'] },
  { alt: 32, rise: ['#113a88', '#17468a', '#22497e', 'rgba(210,228,240,0.6)'] },
  // High summer sun: a fuller cobalt overhead.
  { alt: 60, rise: ['#0d388f', '#13458f', '#1f4a83', 'rgba(214,232,246,0.62)'] },
];

// The daytime sky, from DAY_TONE_ALT up, where type is ink: never deeper than
// DAY_LUM, bluest overhead, the low sky still warm while the sun is low and a
// near-white horizon once it is high.
const DAY_KEYS: Array<{ alt: number; rise: Stops; set?: Stops }> = [
  {
    alt: 8,
    rise: ['#84b0dc', '#b4c6dc', '#ecd4b2', 'rgba(255,220,170,0.72)'],
    set: ['#82acd8', '#bcc2d6', '#f0c8a2', 'rgba(255,196,140,0.74)'],
  },
  { alt: 14, rise: ['#86b5e2', '#accbe8', '#dbe2e4', 'rgba(252,242,226,0.66)'] },
  { alt: 30, rise: ['#88b9e6', '#afd0ed', '#d4e6f3', 'rgba(246,250,252,0.68)'] },
  { alt: 60, rise: ['#80b6e8', '#a8cff0', '#d0e6f6', 'rgba(248,251,253,0.72)'] },
];

/** Where the sky turns pale and type turns ink, climbing or sinking: one step, no blend. */
export const DAY_TONE_ALT = 8;

function mixRgba(a: string, b: string, t: number): string {
  const p = (s: string) => s.match(/[\d.]+/g)!.map(Number);
  const A = p(a);
  const B = p(b);
  const v = A.map((x, i) => x + (B[i] - x) * t);
  return `rgba(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])},${r2(v[3])})`;
}

/** The most a text stop's luminance may be: cream at 72% then keeps 4.6:1 on it. */
const TEXT_LUM = 0.058;

/** The least a daytime text stop's may be: ink at 72% and the day accents then keep 4.5:1 on it. */
const DAY_LUM = 0.42;

/** The most the showcase's sky may be: its faintest type (cream at 55%) and the site's own accents keep 4.5:1. */
const STREET_LUM = 0.022;

function stopsAt(alt: number, rising: boolean, keys = KEYS): Stops {
  const pick = (k: (typeof keys)[number]) => (rising ? k.rise : (k.set ?? k.rise));
  if (alt <= keys[0].alt) return pick(keys[0]);
  let i = 0;
  while (i < keys.length - 1 && alt >= keys[i + 1].alt) i++;
  if (i === keys.length - 1) return pick(keys[i]);
  const a = keys[i];
  const b = keys[i + 1];
  const t = (alt - a.alt) / (b.alt - a.alt);
  const A = pick(a);
  const B = pick(b);
  return [mix(A[0], B[0], t), mix(A[1], B[1], t), mix(A[2], B[2], t), mixRgba(A[3], B[3], t)];
}

/** The colour of the sunlight itself: red-orange on the skyline, gold low, near-white high. */
const SUN: Array<[number, string]> = [
  [-2, '#e8663a'],
  [2, '#f08a3c'],
  [8, '#f6b45e'],
  [18, '#ffd99a'],
  [40, '#fff1d8'],
];
function sunColour(alt: number): string {
  if (alt <= SUN[0][0]) return SUN[0][1];
  for (let i = 0; i < SUN.length - 1; i++) {
    const [a, A] = SUN[i];
    const [b, B] = SUN[i + 1];
    if (alt < b) return mix(A, B, (alt - a) / (b - a));
  }
  return SUN[SUN.length - 1][1];
}

/** Deepened toward black until its luminance is at most `max`, keeping its hue. */
function deepen(c: string, max: number): string {
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

/** Lifted toward white until its luminance is at least `min`, keeping its hue. */
function lighten(c: string, min: number): string {
  if (luminance(c) >= min) return c;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 18; k++) {
    const m = (lo + hi) / 2;
    if (luminance(mix(c, '#ffffff', m)) < min) lo = m;
    else hi = m;
  }
  return mix(c, '#ffffff', hi);
}

/* ---------------------------------------------------------------- the sky */

export type SkyWord = 'night' | 'dawn' | 'dusk' | 'blue hour' | 'sunrise' | 'sunset' | 'golden hour' | 'daylight';

export interface Sky {
  /** The three stops type sits on, zenith to the sky over the skyline, as #rrggbb. */
  top: string;
  mid: string;
  low: string;
  /** A glow along the skyline, rgba(), drawn behind the buildings: it may be light, so no text sits on it. */
  haze: string;
  /** The ground at street level (the hero's shore, the page below it), #rrggbb: night ink, a blue-grey by day. */
  ground: string;
  /** The low sky deepened for small type, #rrggbb: where the showcase's chapters start. */
  street: string;
  /** The day's light laid over the showcase's chapter skies, rgba(): clear at night, the street blue by day. */
  wash: string;
  /** The sunlight's own colour, #rrggbb, for a sun disc or a lit wall. */
  sun: string;
  /** The on-sky accents in the tone's own shades: the site's on-dark orange and petrol (a shade lighter in the golden light), deep burnt orange and petrol on the daytime blue. */
  accent: string;
  accentInk: string;
  /** What type on the sky is set in: cream on the deep sky, ink on the pale daytime one. */
  tone: 'dark' | 'light';
  /** For the dateline: "night", "dawn", "blue hour", "sunrise", "golden hour", "daylight", "sunset", "dusk". */
  word: SkyWord;
  /** How much of the starfield shows, 0..1. */
  stars: number;
  /** How sunlit the scene is, 0 (night) .. 1 (full day). */
  daylight: number;
  /** How golden-red the light is, 0..1: highest with the sun on the skyline. */
  warmth: number;
  /** How strongly a lit window reads, 0..1: full at night, faint by day. */
  windows: number;
  /** How plainly a moon would show, 0..1 (night-ness, not its phase). */
  moon: number;
  /** The sun's height in the sky, 0 (on or under the skyline) .. 1 (70° and up). */
  sunY: number;
  /** Whether any of the sun's disc is above the horizon. */
  sunUp: boolean;
  /** Where the sun stands: east while it climbs, west while it sinks. */
  side: 'east' | 'west';
}

/** The on-dark accents and their daytime shades. */
const ACCENT: [string, string] = ['#e8863a', '#f4b270'];
const ACCENT_INK: [string, string] = ['#7fb8c0', '#a3d2d8'];
/** The accents on the pale daytime sky. */
const DAY_ACCENT = '#6e2c06';
const DAY_ACCENT_INK = '#164651';

/** The sky for a sun altitude in degrees; `rising` picks dawn over dusk for the same light. */
export function skyAt(alt: number, rising: boolean): Sky {
  // The keys are tuned to sit at or under the text ceiling; deepen holds any
  // blend between them to it too, so no altitude can lift a stop past it.
  const [t0, m0, l0, h0] = stopsAt(alt, rising);
  const dark = [t0, m0, l0].map((c) => deepen(c, TEXT_LUM));
  const tone = alt >= DAY_TONE_ALT ? 'light' : 'dark';
  // From the tone step up, the pale daytime stops (held over DAY_LUM).
  const day = tone === 'light' ? stopsAt(alt, rising, DAY_KEYS) : null;
  const [top, mid, low] = day ? day.slice(0, 3).map((c) => lighten(c, DAY_LUM)) : dark;
  const haze = day ? day[3] : h0;
  const daylight = daylightAt(alt);
  // The lightest dark text stop decides how far the night accents lighten.
  const light = Math.max(...dark.map((c) => luminance(c)));
  const k = clamp((light - 0.028) / (TEXT_LUM - 0.034), 0, 1);
  // The showcase's street always starts from the deep low sky, whatever the tone.
  const street = deepen(dark[2], STREET_LUM);
  const [sr, sg, sb] = hex(street);
  const word: SkyWord =
    alt > 12
      ? 'daylight'
      : alt > 4
        ? 'golden hour'
        : alt > -2
          ? rising
            ? 'sunrise'
            : 'sunset'
          : alt > -6
            ? 'blue hour'
            : alt > -12
              ? rising
                ? 'dawn'
                : 'dusk'
              : 'night';
  return {
    top,
    mid,
    low,
    haze,
    ground: groundAt(alt),
    street,
    wash: `rgba(${sr},${sg},${sb},${r2(0.55 * daylight)})`,
    sun: sunColour(alt),
    accent: day ? DAY_ACCENT : mix(ACCENT[0], ACCENT[1], k),
    accentInk: day ? DAY_ACCENT_INK : mix(ACCENT_INK[0], ACCENT_INK[1], k),
    tone,
    word,
    // Every star from -15°; they thin through the twilight and are gone by -6°.
    stars: r2(clamp((-alt - 6) / 9, 0, 1)),
    daylight,
    warmth: r2(smooth(-8, -1, alt) * (1 - smooth(3, 14, alt))),
    windows: r2(1 - 0.85 * smooth(-8, 8, alt)),
    moon: r2(1 - smooth(-10, -2, alt)),
    sunY: r2(clamp(alt / 70, 0, 1)),
    sunUp: alt > -1,
    side: rising ? 'east' : 'west',
  };
}

/**
 * The sky as CSS custom properties, for a `style=` attribute: the stops
 * (--sky-top, --sky-mid, --sky-low, --sky-haze, --sky-ground, --sky-street,
 * --sky-wash, --sky-sun), the on-sky accents (--sky-accent, --sky-accent-ink),
 * and the light model as plain numbers (--stars, --daylight, --warmth,
 * --windows, --moon, --sun-y) with --sun-x, a percentage across the picture:
 * left of centre while the sun climbs, right while it sinks, nearer the
 * middle the higher it stands.
 */
export function skyVars(s: Sky): string {
  const x = Math.round(50 + (s.side === 'east' ? -1 : 1) * 36 * (1 - s.sunY));
  return [
    `--sky-top:${s.top}`,
    `--sky-mid:${s.mid}`,
    `--sky-low:${s.low}`,
    `--sky-haze:${s.haze}`,
    `--sky-ground:${s.ground}`,
    `--sky-street:${s.street}`,
    `--sky-wash:${s.wash}`,
    `--sky-sun:${s.sun}`,
    `--sky-accent:${s.accent}`,
    `--sky-accent-ink:${s.accentInk}`,
    `--stars:${s.stars}`,
    `--daylight:${s.daylight}`,
    `--warmth:${s.warmth}`,
    `--windows:${s.windows}`,
    `--moon:${s.moon}`,
    `--sun-y:${s.sunY}`,
    `--sun-x:${x}%`,
  ].join(';');
}
