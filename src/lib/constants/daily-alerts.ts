export interface DailyAlertsSummary {
  status: 'ok' | 'empty' | 'failed';
  since: string;
  asOf: string;
  total: number;
  high: number;
  items: Array<{ id: string; title: string; content: string; significance: string; createdAt: string }>;
}
export const DAILY_ALERTS_HREF = '/jkai/intel/alerts';
export function dailyAlertsText(summary: DailyAlertsSummary): string {
  if (summary.status === 'failed') return 'Daily alerts unavailable.';
  if (!summary.total) return 'No undismissed alerts in the last 24 hours.';
  return `${summary.total} undismissed alert${summary.total === 1 ? '' : 's'} in the last 24 hours · ${summary.high} high significance`;
}
