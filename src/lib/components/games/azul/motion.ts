// The Azul board's motion: one crossfade shared by every place a tile can
// be — a factory, the centre, a pattern line, the floor, the wall — keyed by
// the tile's id, so a tile leaving one place flies to where it lands. A tile
// with nowhere to come from (dealt from the bag) or go to (into the lid)
// takes the fallback: it rises in, or settles away.

import { crossfade } from 'svelte/transition';
import { cubicOut } from 'svelte/easing';
import type { WireRoom } from '$lib/games/azul';

export type AzulRoom = WireRoom;
export type AzulPlayer = WireRoom['players'][number];
export type AzulTileWire = { id: number; c: string };

export const COLOURS = ['blue', 'yellow', 'red', 'black', 'white'] as const;

/** The colour a wall square takes: row 0 is blue, yellow, red, black, white, each row shifted one. */
export function wallColour(row: number, col: number): string {
  return COLOURS[(((col - row) % 5) + 5) % 5];
}

export const FLOOR_PENALTIES = [1, 1, 2, 2, 2, 3, 3] as const;

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const [send, receive] = crossfade({
  duration: (d) => (reduced() ? 0 : Math.min(900, 380 + Math.sqrt(d) * 14)),
  easing: cubicOut,
  fallback(_node, params, intro) {
    const out = !intro;
    return {
      delay: (params as { delay?: number }).delay ?? 0,
      duration: reduced() ? 0 : out ? 420 : 520,
      easing: cubicOut,
      css: (t) => `opacity: ${t}; transform: translateY(${(1 - t) * (out ? 30 : -40)}%) scale(${0.6 + 0.4 * t});`,
    };
  },
});
