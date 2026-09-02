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
// `TONE_RANK` orders them the way the page should: what is broken first, what
// needs you second, and what is merely true last. Sorting a list "by priority"
// anywhere on this page means sorting on this rank.
//
// Pure — no DOM, no fetch, no Svelte. The page maps tone → CSS class and the
// tests assert the mapping rather than a screenshot.

export type Tone = 'urgent' | 'action' | 'watch' | 'good' | 'steady' | 'quiet';

/** Lower sorts first. What is broken, then what needs you, then the rest. */
export const TONE_RANK: Record<Tone, number> = {
  urgent: 0,
  action: 1,
  watch: 2,
  good: 3,
  steady: 4,
  quiet: 5,
};

export function byTone(a: Tone, b: Tone): number {
  return TONE_RANK[a] - TONE_RANK[b];
}

/**
 * A thought's tone.
 *
 * `action` is reserved for the one case that is genuinely a call to action:
 * it reached him and he has not said whether it was any good. That is the
 * input the whole learning loop is starved of, so it is the thing the page
 * should colour brightest.
 */
export function thoughtTone(t: {
  status: string;
  feedback?: string | null;
  suppressedReason?: string | null;
  reviewVerdict?: string | null;
  verified?: boolean | null;
}): Tone {
  // A refuted review is the engine telling you it nearly said something wrong.
  if (t.reviewVerdict === 'refuted') return 'urgent';
  if (t.status === 'dismissed') return 'quiet';
  if (t.status === 'snoozed') return 'quiet';
  if (t.feedback) return 'steady';
  if (t.status === 'actioned') return 'good';
  if (t.status === 'delivered' || t.status === 'seen' || t.status === 'new') return 'action';
  if (t.status === 'suppressed') return t.suppressedReason === 'feed_only' ? 'quiet' : 'watch';
  return 'steady';
}

/** Where a thought sits in the reading order: unrated first, dead last. */
export function thoughtRank(t: Parameters<typeof thoughtTone>[0]): number {
  return TONE_RANK[thoughtTone(t)];
}

/** A detector: muted is a choice, not-ready is a wait, ready is good. */
export function detectorTone(d: {
  muted?: boolean;
  readiness?: { ready?: boolean } | null;
}): Tone {
  if (d.muted) return 'quiet';
  if (d.readiness?.ready) return 'good';
  return 'watch';
}

/**
 * A scheduled job.
 *
 * A consecutive-failure count is urgent; a `skipped` outcome is a wait, not a
 * fault — but a job that has NEVER run is a wait the page should still show,
 * because "never" and "quiet" are the pair this hub exists to separate.
 */
export function jobTone(j: {
  consecutiveFailures?: number;
  pulse?: { outcome?: string } | null;
}): Tone {
  if ((j.consecutiveFailures ?? 0) > 0) return 'urgent';
  const outcome = j.pulse?.outcome;
  if (outcome === 'error') return 'urgent';
  if (outcome === 'skipped') return 'watch';
  if (outcome === 'ok') return 'good';
  return 'watch';
}

/** The reviewer's verdict on a THOUGHT — the adjudication stage, not the
 *  hypothesis board. A refutation is the engine nearly saying something wrong,
 *  so it wears the loud colour; a verified claim is settled and reads calm. */
export function reviewTone(verdict: string | null | undefined): Tone {
  if (verdict === 'refuted') return 'urgent';
  if (verdict === 'verified') return 'good';
  if (verdict === 'uncertain') return 'watch';
  return 'quiet';
}

/** A hypothesis verdict. `null` means it has not been answered yet. */
export function verdictTone(verdict: string | null | undefined): Tone {
  switch (verdict) {
    case 'supported':
      return 'good';
    case 'refuted':
      return 'steady';
    case 'wrong_direction':
      return 'action';
    case 'underpowered':
      return 'watch';
    case null:
    case undefined:
      return 'watch';
    default:
      return 'steady';
  }
}

/** A line of enquiry. Open ones are live work; anything else is closed. */
export function leadTone(status: string): Tone {
  return status === 'open' ? 'good' : 'quiet';
}

/**
 * A provenance link's state, as the Engine tab draws it.
 *
 * `by_design` is a closed path someone chose to close, so it is quiet rather
 * than a warning — the page's whole point is that a deliberate gap and a
 * broken one must not look the same.
 */
export function provenanceTone(state: string): Tone {
  switch (state) {
    case 'flowing':
      return 'good';
    case 'waiting':
      return 'watch';
    case 'blocked':
    case 'failed':
      return 'urgent';
    case 'by_design':
      return 'quiet';
    default:
      return 'steady';
  }
}

/**
 * The likelihood band a thought's score falls in, as a tone.
 *
 * The band ids come from `thought-groups.ts` and are the reader-facing words:
 * `held` is below the bar, so it is a wait; anything above it is a fact the
 * engine was willing to act on.
 */
export function bandTone(bandId: string): Tone {
  switch (bandId) {
    case 'held':
      return 'watch';
    case 'strong':
      return 'action';
    case 'likely':
      return 'steady';
    default:
      return 'steady';
  }
}

/**
 * A place, from the owner's point of view: an unnamed one visited often enough
 * to be worth asking about is the highest-value action on the whole hub —
 * several detectors are inert until it has a name.
 */
export function placeTone(p: {
  label?: string | null;
  status?: string;
  distinctDays?: number;
}, askAtVisits: number): Tone {
  if (p.status && p.status !== 'active') return 'quiet';
  if (p.label) return 'good';
  return (p.distinctDays ?? 0) >= askAtVisits ? 'action' : 'watch';
}
