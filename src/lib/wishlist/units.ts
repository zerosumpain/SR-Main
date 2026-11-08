// Reading a measurement out of a listing's words, for ANY kind of thing — a
// TV's screen, a holiday's nights, a LEGO set's pieces. PURE and
// deterministic, like `specs.ts`: each unit is a fixed pattern, so a verdict
// can always show which words it read. The model never reads a listing; it
// only chooses, once per item, which of these units the ask is about.
//
// Units here are the closed vocabulary `validateCompiled` accepts. Adding one
// is adding a pattern and a test, never asking a model.

export interface UnitDef {
  /** How the page writes a value: "55in", "7 nights". */
  format: (n: number) => string;
  /** Every number this unit is written as, in order of appearance. */
  read: (text: string) => number[];
}

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)`;
const num = (s: string) => Number(s.replace(/,/g, ''));
const all = (re: RegExp, pick = 1) => (text: string) => [...text.matchAll(re)].map((m) => num(m[pick])).filter(Number.isFinite);
const plain = (suffix: string) => (n: number) => `${+n.toFixed(2)}${suffix}`;

export const UNITS = {
  // Sizes and capacities
  // 55", 55-inch, 55 inches, 55in — and "55 in" only before a screen word, so "7 in 10" is not a size.
  inch: { format: plain('in'), read: all(new RegExp(`${NUM}(?:\\s*(?:"|”|''|-?\\s?inch(?:es)?\\b)|in\\b|\\s+in\\b(?=\\s*(?:tv|screen|monitor|display|oled|qled|led|4k|laptop|tablet|smart)))`, 'gi')) },
  cm: { format: plain('cm'), read: all(new RegExp(`${NUM}\\s*cm\\b`, 'gi')) },
  litre: { format: plain('L'), read: all(new RegExp(`${NUM}\\s*(?:l|litres?|liters?|ltrs?)\\b`, 'gi')) },
  kg: { format: plain('kg'), read: all(new RegExp(`${NUM}\\s*kg\\b`, 'gi')) },
  gb: {
    format: (n) => (n >= 1000 ? `${+(n / 1000).toFixed(1)}TB` : `${n}GB`),
    read: (text) => [...text.matchAll(new RegExp(`${NUM}\\s*(tb|gb)\\b`, 'gi'))].map((m) => num(m[1]) * (m[2].toLowerCase() === 'tb' ? 1000 : 1)),
  },
  // Power and performance
  watt: { format: plain('W'), read: all(new RegExp(`${NUM}\\s*(?:w|watts?)\\b`, 'gi')) },
  hz: { format: plain('Hz'), read: all(new RegExp(`${NUM}\\s*hz\\b`, 'gi')) },
  mah: { format: plain('mAh'), read: all(new RegExp(`${NUM}\\s*mah\\b`, 'gi')) },
  megapixel: { format: plain('MP'), read: all(new RegExp(`${NUM}\\s*(?:mp|megapixels?)\\b`, 'gi')) },
  hours: { format: plain(' hours'), read: all(new RegExp(`${NUM}\\s*(?:hours?|hrs?)\\b`, 'gi')) },
  // Toys and sets
  pieces: { format: plain(' pieces'), read: all(new RegExp(`${NUM}\\s*(?:pieces|pcs|piece)\\b`, 'gi')) },
  // Travel
  nights: {
    format: plain(' nights'),
    // "7 nights", "7-night", "7 Nts", "a week" (= 7), "fortnight" (= 14). A
    // "week" is a stay unless it is a deal's lifetime ("this week only", "per
    // week"). Over 120 is not a stay — "Feb 2027 … nights" read as 2,027.
    read: (text) => [
      ...all(new RegExp(`${NUM}\\s*-?\\s*(?:nights?|nts?)\\b`, 'gi'))(text).filter((n) => n >= 1 && n <= 120),
      ...(/\bfortnight\b/i.test(text) ? [14] : []),
      ...(/\b(?<!(?:this|next|last|per|every|each)\s)week(?!end|s\b|day)\b/i.test(text) ? [7] : []),
    ],
  },
  stars: {
    format: (n) => `${n}★`,
    // "4-star", "4 star", "4*", "4⭐", "4🌟" — hotel ratings run 1–5.
    read: (text) =>
      all(/\b([1-5](?:\.5)?)\s*(?:-?\s*stars?\b|\*|⭐|\u{1F31F})/giu)(text).filter((n) => n >= 1 && n <= 5),
  },
  // "sleeps 6", "4 people", "2 adults" — never a bare "for 7", which is as often nights.
  people: {
    format: plain(' people'),
    read: (text) =>
      [...text.matchAll(new RegExp(`sleeps\\s*${NUM}|${NUM}\\s*(?:people|persons|guests|adults)\\b`, 'gi'))].map((m) => num(m[1] ?? m[2])),
  },
  months: { format: plain(' months'), read: all(new RegExp(`${NUM}\\s*-?\\s*months?\\b`, 'gi')) },
  years: { format: plain(' years'), read: all(new RegExp(`${NUM}\\s*-?\\s*(?:years?|yrs?)\\b`, 'gi')) },
} satisfies Record<string, UnitDef>;

export type UnitId = keyof typeof UNITS;

export function isUnit(u: unknown): u is UnitId {
  return typeof u === 'string' && Object.hasOwn(UNITS, u);
}

/**
 * The value a listing states in this unit, or null. Title first: a title is
 * the listing's own summary, a description wanders ("unlike 32in models…").
 * Within a text, the LARGEST reading — a "55in TV" listing that mentions its
 * 3in stand height should read 55, and a "7 or 14 nights" deal offers 14.
 */
export function readUnit(unit: UnitId, title: string, description = ''): number | null {
  for (const text of [title, description]) {
    const values = UNITS[unit].read(text);
    if (values.length) return Math.max(...values);
  }
  return null;
}

export function formatUnit(unit: UnitId, n: number): string {
  return UNITS[unit].format(n);
}
