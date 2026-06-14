/**
 * Per-synthesis-run abort registry, keyed by runId. Distinct from the
 * session-keyed abortControllers in worker.ts: cancelling one synthesis run
 * must not abort the whole research session. Session-level requestStop() still
 * cancels everything because the synthesis worker also threads the session
 * abort signal where relevant.
 */
const synthesisAborts = new Map<string, AbortController>();

/** Create (or replace) the AbortController for a run. */
export function registerSynthesisRun(runId: string): void {
  synthesisAborts.set(runId, new AbortController());
}

/** The abort signal for a run, or undefined if not registered. */
export function getSynthesisSignal(runId: string): AbortSignal | undefined {
  return synthesisAborts.get(runId)?.signal;
}

/** Abort a single run. No-op if the run is unknown. */
export function requestStopSynthesis(runId: string): void {
  synthesisAborts.get(runId)?.abort(new Error('Synthesis cancelled'));
}

/** Whether a run has been aborted (false for unknown runs). */
export function isSynthesisAborted(runId: string): boolean {
  return synthesisAborts.get(runId)?.signal.aborted === true;
}

/** Drop a run's controller once it has terminated. */
export function clearSynthesisRun(runId: string): void {
  synthesisAborts.delete(runId);
}
