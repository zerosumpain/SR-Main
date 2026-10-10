// wildmind-glass.ts — Wildmind's valley as the place view draws it: an
// architect's planning model under a glass vitrine in a gallery window, a
// layer of card for every step of height (showcase-place-wildmind.ts lays out
// the gallery round it, GlassArt.svelte draws it).
//
// The model is worked out on the server, once per terrain version
// (wildmind-glass.server.ts): the cards' outlines, already tilted toward the
// street and clipped to the land they've seen, the trees and the marsh marks
// on each card, and which card every cell of the valley stands on. This
// module is the shape the browser gets and the little it does with it: where
// a point on the valley's map (a person, a hut, an animal) stands on the
// model. Client-safe and pure; the tracer is server only.

/** The board the model stands on, in the place scene's units: `w` across, `d` deep as seen from the street, `pad` kept clear round the model. */
export const BOARD = { w: 420, d: 150, pad: 10 } as const;
/** How much a step back into the model rises up the picture: the street's view down onto it. */
export const TILT = 0.32;

/** One card of the model: everything at or above one height, standing `lift` above the board. */
export interface GlassCard {
  /** Board units the card's top stands above the board. */
  lift: number;
  /** Its outline at board level (drawn translated up by `lift`): smoothed rings, even-odd. */
  d: string;
  /** The lichen trees standing on this card, as round-capped dots: small crowns, then big ones. Board units, already lifted. */
  wood?: [string, string];
  /** The marsh marks on this card, already lifted. */
  wet?: string;
}

/** The model as the browser gets it (`WildmindShowcase.glass`), worked out once per terrain version. */
export interface WildmindGlass {
  /** The terrain version it was built from (the answer's mapVersion). */
  version: string;
  /** Map units to the board: x' = ox + x·su, y' = oy + y·sv, then up by the lift of the card underneath. */
  ox: number;
  oy: number;
  su: number;
  sv: number;
  /** The cards, lowest first. The lowest is everything seen, painted as water, so lakes are where nothing higher covers it. */
  cards: GlassCard[];
  /** The tree crowns' radii, small and big, in board units. */
  tree: [number, number];
  /** Which card each cell stands on ('a' the lowest), row by row and run-length coded: "c12d3b". */
  bands: string;
  /** The grid `bands` covers, in cells, and cells per map unit. */
  gw: number;
  gh: number;
  per: number;
}

/** The band grid, decoded. Throws nothing: a short or malformed code leaves the rest on the lowest card. */
export function decodeBands(g: Pick<WildmindGlass, 'bands' | 'gw' | 'gh'>): Uint8Array {
  const out = new Uint8Array(Math.max(0, g.gw * g.gh));
  let k = 0;
  for (const m of g.bands.matchAll(/([a-z])(\d*)/g)) {
    const band = m[1].charCodeAt(0) - 97;
    const run = m[2] ? Number(m[2]) : 1;
    out.fill(band, k, Math.min(out.length, k + run));
    k += run;
    if (k >= out.length) break;
  }
  return out;
}

/** The run-length code for a band grid (the inverse of decodeBands). */
export function encodeBands(bands: ArrayLike<number>): string {
  let s = '';
  for (let k = 0; k < bands.length; ) {
    let n = 1;
    while (k + n < bands.length && bands[k + n] === bands[k]) n++;
    s += String.fromCharCode(97 + bands[k]) + (n > 1 ? n : '');
    k += n;
  }
  return s;
}

/** Where a point on the valley's map stands on the model, in board units: on the card under it. */
export function glassAt(g: WildmindGlass, bands: Uint8Array, x: number, y: number): { x: number; y: number; lift: number } {
  const i = Math.min(g.gw - 1, Math.max(0, Math.floor(x * g.per)));
  const j = Math.min(g.gh - 1, Math.max(0, Math.floor(y * g.per)));
  const card = g.cards[Math.min(g.cards.length - 1, bands[j * g.gw + i] ?? 0)];
  const lift = card?.lift ?? 0;
  return { x: g.ox + x * g.su, y: g.oy + y * g.sv - lift, lift };
}
