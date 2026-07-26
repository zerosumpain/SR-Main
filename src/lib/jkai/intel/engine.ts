// Nightly intel maintenance.
//
// Everything phase 2 added has a batch half that nothing was calling: the
// watchlist only diffs when someone hits its endpoint, live-query lenses only
// evaluate on demand, and confidence scores only refresh for entities that get
// touched. A watchlist that only tells you what changed when you remember to
// ask is not a watchlist.
//
// Modelled on $lib/selfimprove/engine and $lib/briefing/engine: an interval
// that checks the wall clock, prod-gated by hostname, with a kill switch. Not
// a cron dependency, so it survives a host with no crontab.
import { runWatchlistCheck } from './watchlist';
import { runDueLensChecks } from './lenses.server';
import { backfillConfidence } from './trust-refresh';
import { invalidateGraphAnalysis } from './analytics/load';

/** Local hour the sweep runs at. After the 03:30 self-improvement pass. */
const RUN_HOUR = 4;
const RUN_MINUTE = 15;
/** How often the clock is checked. Coarse on purpose — this is not urgent. */
const TICK_MS = 5 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let lastRunDay: string | null = null;

export function isIntelEngineEnabled(): boolean {
  if (process.env.JKAI_BUILDER_PROCESS === '1') return false;
  return process.env.INTEL_ENGINE !== '0';
}

export interface IntelSweepResult {
  confidenceScored: number;
  watchChanges: number;
  lensChanges: number;
  errors: string[];
}

/**
 * One maintenance pass. Ordered deliberately: confidence first, because both
 * the watchlist diff and any lens with a confidence floor read it, and a NULL
 * score silently excludes an entity from every such filter.
 */
export async function runIntelSweep(): Promise<IntelSweepResult> {
  const result: IntelSweepResult = {
    confidenceScored: 0,
    watchChanges: 0,
    lensChanges: 0,
    errors: [],
  };

  // Each stage is isolated: one failing must not cost the others, since a
  // silent no-op is exactly the failure mode this engine exists to prevent.
  try {
    const { scored } = await backfillConfidence();
    result.confidenceScored = scored;
  } catch (err) {
    result.errors.push(`confidence: ${err instanceof Error ? err.message : err}`);
  }

  try {
    invalidateGraphAnalysis();
    const watch = await runWatchlistCheck();
    result.watchChanges = watch.changes?.length ?? 0;
  } catch (err) {
    result.errors.push(`watchlist: ${err instanceof Error ? err.message : err}`);
  }

  try {
    const lens = await runDueLensChecks();
    result.lensChanges = lens.length;
  } catch (err) {
    result.errors.push(`lenses: ${err instanceof Error ? err.message : err}`);
  }

  console.log(
    `[intel:engine] sweep — ${result.confidenceScored} scored, ${result.watchChanges} watch changes, ` +
      `${result.lensChanges} lens changes${result.errors.length ? `, ${result.errors.length} errors` : ''}`,
  );
  return result;
}

export function startIntelEngine(): void {
  if (timer || !isIntelEngineEnabled()) return;

  timer = setInterval(() => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    // Guarded on the DAY, not on a timer that could drift: a restart at 04:20
    // must not re-run a sweep that already happened.
    if (day === lastRunDay) return;
    if (now.getHours() !== RUN_HOUR || now.getMinutes() < RUN_MINUTE) return;
    lastRunDay = day;
    void runIntelSweep().catch((err) => console.error('[intel:engine] sweep failed:', err));
  }, TICK_MS);

  // Node keeps the process alive for an interval otherwise, which would hold a
  // deploy's SIGTERM open for up to five minutes.
  timer.unref?.();
  console.log(`[intel:engine] started — nightly sweep at ${RUN_HOUR}:${String(RUN_MINUTE).padStart(2, '0')}`);
}

export function stopIntelEngine(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
