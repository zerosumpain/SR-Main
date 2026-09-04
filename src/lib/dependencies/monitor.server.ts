import { DEPENDENCY_POLL_INTERVAL_MS } from './catalog';
import { readGatusPublicJourney } from './gatus.server';
import { recordDependencyObservations } from './history.server';
import { probeDependencies } from './probe.server';

let interval: ReturnType<typeof setInterval> | null = null;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

/** Shared by the scheduler and the admin's explicit Refresh action. */
export function runDependencyCheck(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const [observations, independentPublicHistory] = await Promise.all([
      probeDependencies(),
      readGatusPublicJourney(),
    ]);
    await recordDependencyObservations([...observations, ...independentPublicHistory]);
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function startDependencyMonitor(): void {
  if (interval || bootTimer) return;
  // Let the process finish booting and its DB pool settle before the first
  // nine-way network pass. The admin API can trigger the first pass sooner.
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void runDependencyCheck().catch((error) =>
      console.error('[dependencies] initial check failed:', error instanceof Error ? error.message : error),
    );
    interval = setInterval(() => {
      void runDependencyCheck().catch((error) =>
        console.error('[dependencies] scheduled check failed:', error instanceof Error ? error.message : error),
      );
    }, DEPENDENCY_POLL_INTERVAL_MS);
    interval.unref?.();
  }, 15_000);
  bootTimer.unref?.();
}

export function stopDependencyMonitor(): void {
  if (bootTimer) clearTimeout(bootTimer);
  if (interval) clearInterval(interval);
  bootTimer = null;
  interval = null;
}
