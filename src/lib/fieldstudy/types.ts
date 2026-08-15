/**
 * The Field Study System's shipped types.
 *
 * `Confidence` is the one that matters: three levels, and the system's hard
 * constraint is that nobody invents a fourth or renames these. Every claim in
 * a study carries one, and the chip that renders it uses the SITE palette —
 * petrol for fact, orange for hypothesis, claret for contested — never the
 * categorical hues, which are licensed only inside a legend and the marks that
 * legend labels.
 *
 * Studies that previously kept their own copies (data-spine, policy-engine,
 * dfe-data-strategy) had drifted to three different palettes, two of them
 * colouring a claim with a categorical hue. This module is the single home.
 */
export type Confidence = 'fact' | 'hypothesis' | 'contested';

export const CONFIDENCE_LEVELS: readonly Confidence[] = ['fact', 'hypothesis', 'contested'];

/** Display text for each level. */
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  fact: 'Fact',
  hypothesis: 'Hypothesis',
  contested: 'Contested',
};

/**
 * Map a study's older, richer confidence vocabulary onto the shipped three.
 *
 * policy-engine and dfe-data-strategy grade evidence as
 * high/medium/low/assumption/contested. That scale is about how strong the
 * evidence is; this one is about what kind of statement is being made. The
 * mapping is deliberately lossy and deliberately conservative — anything short
 * of well-evidenced becomes a hypothesis rather than a fact, because the
 * system's whole point is that a study does not overstate itself.
 */
const LEGACY: Record<string, Confidence> = {
  fact: 'fact',
  high: 'fact',
  'well-evidenced': 'fact',
  hypothesis: 'hypothesis',
  medium: 'hypothesis',
  moderate: 'hypothesis',
  low: 'hypothesis',
  assumption: 'hypothesis',
  contested: 'contested',
  disputed: 'contested',
};

export function toConfidence(level: string | null | undefined): Confidence {
  if (!level) return 'hypothesis';
  return LEGACY[level.toLowerCase()] ?? 'hypothesis';
}
