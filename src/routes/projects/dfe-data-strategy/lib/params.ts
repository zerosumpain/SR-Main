// params.ts — the alignment engine's coefficients, in one place, with provenance.
// Nothing here is a black box: the Method page renders these and the trace viewer
// decomposes every headline number back to them.

export const PARAMS = {
  /** Capability response curve: cap_base = 1 − exp(−CAP_K · x), where x = (area's share
   *  of total allocation) × (number of areas). An even split gives x=1 → ~0.59; doubling
   *  an area's share gives x=2 → ~0.83 (diminishing returns). */
  CAP_K: 0.9,

  /** Posture multiplier is clamped to this band so no single stance can zero-out or
   *  runaway a capability. cap = cap_base × clamp(1 + Σ postureValue·affectWeight, …). */
  MULT_MIN: 0.35,
  MULT_MAX: 1.6,

  /** Maturity: projected level = current + (target − current) · progress, where progress is
   *  the mean effective capability of the dimension's driving areas, with a small penalty
   *  when the target is set well above current but the driving areas are under-resourced. */
  MATURITY_GAP_PENALTY: 0.25,

  /** Recommended-focus weighting: pressures ranked by severity·(1 − coverage). */
  FOCUS_TOP_N: 6,
} as const;

/** Notes shown on the Method page next to each coefficient. */
export const PARAM_NOTES: Record<string, string> = {
  CAP_K:
    'Concave-saturating so that piling effort into one capability yields diminishing returns — a deliberate guard against single-issue strategies.',
  MULT_MIN:
    'Posture choices tilt effectiveness but cannot make a funded capability worthless, nor a starved one strong.',
  MATURITY_GAP_PENALTY:
    'Ambitious maturity targets that are not backed by investment in the driving capabilities are discounted — strategy as wish-list is penalised.',
};
