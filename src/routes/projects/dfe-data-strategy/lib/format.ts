// format.ts — small shared formatting + math helpers.

export const clamp = (x: number, lo = 0, hi = 1): number => Math.max(lo, Math.min(hi, x));

export const pct = (x: number, dp = 0): string => `${(x * 100).toFixed(dp)}%`;

export function fmtNum(n: number, dp = 0): string {
  if (!Number.isFinite(n)) return '–';
  return n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Concave saturating response: diminishing returns as x grows. x≥0. */
export function saturate(x: number, k = 0.9): number {
  if (x <= 0) return 0;
  return 1 - Math.exp(-k * x);
}

/** Round to a step (used for slider snapping). */
export const snap = (x: number, step: number): number => Math.round(x / step) * step;

export const titleCase = (s: string): string =>
  s.replace(/(^|\s|-)([a-z])/g, (_, p, c) => p + c.toUpperCase());
