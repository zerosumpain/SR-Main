import type { Artefact } from './contracts';

// Ranking an exploitation play, deterministically.
//
// The model judges four things a policy professional can argue with, each on
// [0,1]: how much the actor GAINS, how EASY the play is, how much it costs the
// policy's objective, and how well it hides. The ranking itself is computed here
// rather than asked for, so two runs over the same judgements rank the same way
// and the arithmetic can be shown on the page.
//
// The combination is a geometric mean, not a product: four 0.5s should read as
// 0.5, and a play nobody has any incentive to run should fall to the bottom no
// matter how easy it is. A product does the second but not the first.

export const EXPOSURE_FACTORS = [
  ['incentive', 'What the actor gains by doing it'],
  ['ease', 'How little effort, capability or cost it takes'],
  ['impact', 'How much of the policy objective it defeats'],
  ['concealment', 'How poorly the policy would notice'],
] as const;

export const BANDS = [
  { band: 'severe', floor: 0.7, note: 'Strong incentive, low effort, real damage, and hard to see. Redesign before publication.' },
  { band: 'significant', floor: 0.5, note: 'A play a rational actor would consider. Needs a counter-measure or an explicit acceptance.' },
  { band: 'moderate', floor: 0.3, note: 'Plausible but constrained. Worth a monitoring commitment.' },
  { band: 'limited', floor: 0, note: 'Weak on at least one factor. Recorded for completeness.' },
] as const;

export type Band = (typeof BANDS)[number]['band'];

/** Geometric mean of the four factors, on [0,1]. */
export function exposureOf(data: Record<string, unknown>): number {
  const values = EXPOSURE_FACTORS.map(([key]) => {
    const v = Number(data[key]);
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  });
  if (values.some((v) => v === 0)) return 0;
  return Math.exp(values.reduce((sum, v) => sum + Math.log(v), 0) / values.length);
}

export function bandOf(exposure: number): (typeof BANDS)[number] {
  return BANDS.find((b) => exposure >= b.floor) ?? BANDS[BANDS.length - 1];
}

/**
 * Stamp `exposure` and `band` onto every exploitation play, and set the
 * artefact's confidence to the same figure so existing surfaces that read
 * confidence rank plays sensibly too.
 */
export function scoreExploits(artefacts: Artefact[]): Artefact[] {
  for (const a of artefacts) {
    if (a.kind !== 'exploit') continue;
    const exposure = exposureOf(a.data);
    a.data.exposure = Number(exposure.toFixed(4));
    a.data.band = bandOf(exposure).band;
    a.confidence = Number(exposure.toFixed(4));
  }
  return artefacts;
}

/** Highest-exposure plays first — the order the assessment should be read in. */
export function byExposure(a: Artefact, b: Artefact): number {
  return Number(b.data.exposure ?? 0) - Number(a.data.exposure ?? 0);
}
