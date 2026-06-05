// Subtle, reduced-motion-aware animation helpers shared across the site.
//
// Svelte's transitions/animations don't consult `prefers-reduced-motion`
// themselves, so route every duration through `dur()`. It collapses to 0 for
// visitors who ask for reduced motion — making the effect instant (i.e. off) —
// while staying a transparent pass-through for everyone else.

function reducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function dur(ms: number): number {
  return reducedMotion() ? 0 : ms;
}
