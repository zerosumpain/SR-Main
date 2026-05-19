/** Adaptive USD formatter: sub-cent → 4 decimals, otherwise 2 decimals. */
export function formatUsd(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v === 0) return '$0.00';
  if (Math.abs(v) < 0.01) {
    return `$${v.toFixed(4)}`;
  }
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Token counter: thousands-separator below 10k, k/m suffix above. */
export function formatTokens(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  if (v < 10_000) return v.toLocaleString('en-US');
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`;
  return `${(v / 1_000_000).toFixed(1)}m`;
}
