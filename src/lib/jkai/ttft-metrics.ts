/**
 * Lightweight TTFT (time-to-first-token) instrumentation for jkai canvas chat.
 *
 * Usage:
 *   const m = startTtftMark(jobId);
 *   // ... send request ...
 *   m.onFirstToken();  // call this on the first 'token' or 'thinking' event for jobId
 *
 * Logs to console (always) and `performance.measure()` (for DevTools Performance
 * panel). No external telemetry — purely a local diagnostic.
 */
export function startTtftMark(jobId: string): { onFirstToken: () => void } {
  const t0 = performance.now();
  const sendMark = `ttft:send:${jobId}`;
  const firstMark = `ttft:first:${jobId}`;
  const measure = `ttft:${jobId}`;
  try {
    performance.mark(sendMark);
  } catch {
    /* ignore — performance API may be unavailable in SSR */
  }
  let fired = false;
  return {
    onFirstToken: () => {
      if (fired) return;
      fired = true;
      const elapsed = performance.now() - t0;
      try {
        performance.mark(firstMark);
        performance.measure(measure, sendMark, firstMark);
      } catch {
        /* ignore */
      }
      // eslint-disable-next-line no-console
      console.log(`[ttft] ${elapsed.toFixed(0)}ms (jobId=${jobId})`);
    },
  };
}
