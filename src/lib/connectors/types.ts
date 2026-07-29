// Connector health — one honest answer per integration.
//
// The rule this module exists to enforce: a probe reports what it just
// OBSERVED, never what a status column claims. `health_sync_state` said
// apple_health last synced in March while metrics were arriving that morning;
// `gmail_accounts.status` can say 'active' with a dead refresh token. Stored
// status is a cache of the last time something ran, not evidence the connector
// works now — presenting it as the latter is the same defect that let the
// morning briefing invent data.

export type ConnectorStatus =
  /** Probed and working. */
  | 'ok'
  /** Working but something needs attention (stale data, expiring token). */
  | 'degraded'
  /** Confirmed not working — needs a fix. */
  | 'broken'
  /** No credentials configured. Not a failure; just absent. */
  | 'unconfigured';

export interface ConnectorReport {
  key: string;
  label: string;
  /** Grouping for the dashboard, e.g. 'Email', 'Home', 'Health', 'AI'. */
  group: string;
  status: ConnectorStatus;
  /** What the probe actually saw. Shown verbatim — no interpretation. */
  detail: string;
  /** True when the probe made a real network/API call rather than reading a row. */
  live: boolean;
  /** Where to go to fix it. */
  fixUrl?: string;
  /** What to do there. */
  fixHint?: string;
  checkedAt: string;
  /** How long the probe took, so a slow-but-working connector is visible. */
  ms: number;
}

/** Ordering for the dashboard and the alert: worst first. */
export const STATUS_RANK: Record<ConnectorStatus, number> = {
  broken: 0,
  degraded: 1,
  unconfigured: 2,
  ok: 3,
};

export function sortReports(reports: ConnectorReport[]): ConnectorReport[] {
  return [...reports].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.label.localeCompare(b.label),
  );
}

/** Connectors that are broken — the set worth waking someone for. */
export function brokenOf(reports: ConnectorReport[]): ConnectorReport[] {
  return reports.filter((r) => r.status === 'broken');
}
