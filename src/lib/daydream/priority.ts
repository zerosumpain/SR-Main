// One tone vocabulary for the daydream hub.
//
// The page renders a dozen different status words — `delivered`, `suppressed`,
// `proposed`, `ready`, `muted`, `supported`, `underpowered`, `skipped`,
// `error` — and before this they each carried their own colour, chosen where
// they were written. The result is that a failed nightly job and a detector
// that is merely still gathering history looked equally alarming, and the one
// thing actually waiting on the owner looked like everything else.
//
// So the colours are decided HERE, once, off six tones:
//
//   urgent   something is broken and the engine is not doing its job
//   action   it is waiting on YOU — a name, a verdict, an approval
//   watch    it is waiting on TIME — gathering, pending, due
//   good     it worked, it holds, it is live
//   steady   a fact, neither good nor bad
//   quiet    dormant by choice — muted, ignored, closed
//
// Pure — no DOM, no fetch, no Svelte. The page maps tone → CSS class and the
// tests assert the mapping rather than a screenshot.

export type Tone = 'urgent' | 'action' | 'watch' | 'good' | 'steady' | 'quiet';

/**
 * A think note on the one feed. A note has no review and no place: it is waiting on a verdict, or it has one. Useful is
 * good; not useful and never are finished business.
 */
export function noteTone(n: { verdict: string | null }): Tone {
  if (!n.verdict) return 'action';
  return n.verdict === 'useful' ? 'good' : 'quiet';
}
