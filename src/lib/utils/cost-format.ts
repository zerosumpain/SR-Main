/** USD→GBP conversion rate. LLM providers bill in USD; costs are stored in
 *  USD and converted to GBP for display only. Editable — bump when the
 *  rate drifts, or wire to a live FX source later. */
export const GBP_PER_USD = 0.79;

/** Convert a USD amount to GBP. */
export function usdToGbp(usd: number): number {
  return usd * GBP_PER_USD;
}

/** Adaptive GBP formatter: sub-penny → 4 decimals, otherwise 2 decimals. */
export function formatGbp(usdAmount: number | null | undefined): string {
  if (usdAmount === null || usdAmount === undefined) return '—';
  const v = usdAmount * GBP_PER_USD;
  if (v === 0) return '£0.00';
  if (Math.abs(v) < 0.01) {
    return `£${v.toFixed(4)}`;
  }
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Token counter: thousands-separator below 10k, k/m suffix above. */
export function formatTokens(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v < 10_000) return v.toLocaleString('en-US');
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`;
  return `${(v / 1_000_000).toFixed(1)}m`;
}
