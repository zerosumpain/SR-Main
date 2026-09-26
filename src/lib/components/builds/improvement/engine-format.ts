// Formatting the engine room shares between its page and its four panels.
//
// In a module rather than repeated in each component for the reason `hub/
// types.ts` exists: a Svelte instance script is not something you can import
// out of, so a helper written there has to be written again everywhere it is
// used — and the version that drifts is always the one that decides whether a
// timestamp reads "never" or "just now".

export { ago, when, cadence, pct } from '$lib/daydream/format';

/** Cash, or null when there is none — an activity that cost nothing shows no
 *  corner at all rather than a `$0.00` that looks like a measurement. */
export function usd(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}
