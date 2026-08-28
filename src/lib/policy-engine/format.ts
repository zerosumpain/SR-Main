// format.ts — display helpers. Self-contained to this route.

export function fmtNum(v: number, dp = 0): string {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtPct(v: number, dp = 1): string {
  return `${fmtNum(v, dp)}%`;
}

/** £ with smart unit: 1.2 -> £1.2bn, 0.45 -> £450m. Input is in £bn. */
export function fmtGBPbn(vbn: number, dp = 1): string {
  if (!isFinite(vbn)) return '—';
  const abs = Math.abs(vbn);
  if (abs >= 1) return `£${fmtNum(vbn, dp)}bn`;
  if (abs >= 0.001) return `£${fmtNum(vbn * 1000, 0)}m`;
  return `£${fmtNum(vbn * 1_000_000, 0)}k`;
}

/** Pounds per pupil etc. */
export function fmtGBP(v: number, dp = 0): string {
  return `£${fmtNum(v, dp)}`;
}

export function fmtMonths(v: number, dp = 1): string {
  return `${fmtNum(v, dp)} mo`;
}

export function fmtSigned(v: number, dp = 1, suffix = ''): string {
  const s = v > 0 ? '+' : '';
  return `${s}${fmtNum(v, dp)}${suffix}`;
}

/** Thousands compact: 638700 -> 639k, 1290000 -> 1.29m. */
export function fmtCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${fmtNum(v / 1_000_000, 2)}m`;
  if (abs >= 1_000) return `${fmtNum(v / 1_000, 0)}k`;
  return fmtNum(v, 0);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function slug(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
}
