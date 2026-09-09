// deterministic RNG so a given scenario yields stable bands across re-renders
// (exported for reuse by the triage model's uncertainty sampling)
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inverse-CDF sample from a triangular(low, central, high) distribution. */
export function triangular(rng: () => number, a: number, c: number, b: number): number {
  if (b <= a) return c;
  const cc = Math.min(Math.max(c, a), b);
  const u = rng();
  const F = (cc - a) / (b - a);
  if (u < F) return a + Math.sqrt(u * (b - a) * (cc - a));
  return b - Math.sqrt((1 - u) * (b - a) * (b - cc));
}
