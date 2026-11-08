// Counter-based randomness. A draw is a pure hash of (seed, stream, a, b, c):
// there is no generator state, so the answer never depends on how many other
// draws happened first, in what order towns stepped, or whether a catch-up was
// split into chunks. Each system draws from its own named stream, so adding a
// draw to one system cannot shift another (spec §10.4).
//
// h32 is our own murmur3-style mixer (multiply–rotate rounds over the inputs,
// then the usual avalanche finaliser), written for this engine.

import { invNormal } from './fx';

/** Named streams. Append only: renumbering one would change every saved county. */
export const STREAMS = {
  develop: 1,
  rank: 2,
  incident: 3,
  world: 4,
  events: 5,
  deals: 6,
  citizens: 7,
  gazette: 8,
  sprint: 9,
  forecast: 10,
  terrain: 11,
  seed: 12,
} as const;
export type StreamId = keyof typeof STREAMS;

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

function round(h: number, k: number): number {
  k = Math.imul(k, C1);
  k = rotl(k, 15);
  k = Math.imul(k, C2);
  h ^= k;
  h = rotl(h, 13);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

/** The final avalanche: every input bit affects every output bit. */
export function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * h32(seed, stream, a, b, c) → a uint32. Inputs are integers; anything else is
 * truncated toward zero first (ToUint32 is exact modulo 2³² for safe integers).
 */
export function h32(seed: number, stream: number, a = 0, b = 0, c = 0): number {
  let h = seed | 0;
  h = round(h, stream | 0);
  h = round(h, a | 0);
  h = round(h, (a / 4294967296) | 0); // the high word of a, so ticks past 2³² still differ
  h = round(h, b | 0);
  h = round(h, c | 0);
  return fmix32(h ^ 20);
}

/** A uint32 as a float in [0, 1). */
export function u01(h: number): number {
  return (h >>> 0) / 4294967296;
}

/** A draw in [0, 1) from a named stream. */
export function uniform(seed: number, stream: StreamId, a = 0, b = 0, c = 0): number {
  return u01(h32(seed, STREAMS[stream], a, b, c));
}

/** True with probability p. */
export function chance(p: number, seed: number, stream: StreamId, a = 0, b = 0, c = 0): boolean {
  return uniform(seed, stream, a, b, c) < p;
}

/** An integer in [0, n). */
export function pickIndex(n: number, seed: number, stream: StreamId, a = 0, b = 0, c = 0): number {
  return Math.floor(uniform(seed, stream, a, b, c) * n);
}

/** A standard normal draw (by the quantile function, so one hash per draw). */
export function normal(seed: number, stream: StreamId, a = 0, b = 0, c = 0): number {
  // +0.5 keeps the argument strictly inside (0, 1).
  return invNormal((h32(seed, STREAMS[stream], a, b, c) + 0.5) / 4294967296);
}

/** Hashes a short string (a seat id, a plan id) to a uint32, FNV-1a 32. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
