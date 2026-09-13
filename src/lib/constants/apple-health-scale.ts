/**
 * How `apple_health_metrics.value` is stored: the real measurement times 100.
 *
 * The column is an integer, and health measurements are not — HRV, VO2 max,
 * resting heart rate and body mass all carry decimals worth keeping. So the
 * ingest multiplies by 100 on the way in and every reader divides by 100 on the
 * way out. There is no marker on the row saying so.
 *
 * This lives in its own module, imported by both sides, because the two sides
 * are no longer in the same repository. The writer is SR-Health's
 * /api/health/apple/ingest; the readers that matter most are here and both are
 * PUBLIC — the homepage's step count and the vitals poll's pulse. A factor that
 * disagreed across that boundary would not fail a build, fail a test, or log
 * anything. It would render a hundred times the right number on the front page.
 *
 * That is not hypothetical in this codebase: a x100 storage-scaling bug has
 * already shipped on steps once.
 *
 * Registered in shared-with-extracted.json / shared-with-main.json, so changing
 * it on one side without the other is a red test rather than a silent drift.
 */
export const APPLE_METRIC_SCALE = 100;

/** Storage integer -> real measurement. */
export function fromStoredMetric(stored: number): number {
  return stored / APPLE_METRIC_SCALE;
}

/** Real measurement -> storage integer. */
export function toStoredMetric(value: number): number {
  return Math.round(value * APPLE_METRIC_SCALE);
}
