/**
 * Workflow-engine liveness probe. systemd `WatchdogSec=` should curl this and
 * restart the service on 503. Returns:
 *  - 503 when the event loop has been blocked &gt;5s (max delay observed in the
 *    sampling window since the last probe) AND no live batch job explains it.
 *    Indicates a wedged sync hot path or an unresponsive process — better to
 *    restart than limp.
 *  - 200 with concurrency stats otherwise.
 *
 * The batch exemption is the difference between "busy" and "broken". A stalled
 * loop used to be reported as a fault whatever caused it, so the nightly intel
 * sweep — legitimately CPU-heavy — tripped the probe and the watchdog restarted
 * the service mid-run, repeatedly, destroying the work each time. A registered
 * batch that is still BEATING now holds the probe healthy; one that has stopped
 * beating does not, so a genuinely stuck job is still restarted within
 * `BATCH_STALE_MS`. See `beginBatch` in $lib/workflows/engine-runtime.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { getRuntimeStats, readEventLoopMaxMs, activeBatches } from '$lib/workflows/engine-runtime';

const MAX_LOOP_DELAY_MS = 5000;

export const GET: RequestHandler = async () => {
  const loopMaxMs = readEventLoopMaxMs();
  const stats = getRuntimeStats();
  const batches = activeBatches();
  const stalled = loopMaxMs >= MAX_LOOP_DELAY_MS;
  // Only a batch that is still reporting progress excuses a stall.
  const excused = stalled && batches.some((b) => !b.stale);
  const ok = !stalled || excused;

  if (excused) {
    console.log(
      `[health] loop stalled ${loopMaxMs}ms but a batch is live — ` +
        batches.map((b) => `${b.name}:${b.phase}`).join(', '),
    );
  }

  return json(
    {
      ok,
      loopMaxMs,
      loopThresholdMs: MAX_LOOP_DELAY_MS,
      // Present so the reason for a 200 during a stall is legible from the
      // outside, rather than looking like the threshold silently moved.
      busyWithBatch: excused,
      batches,
      ...stats,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
};
