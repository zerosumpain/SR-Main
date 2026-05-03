/**
 * Workflow-engine liveness probe. systemd `WatchdogSec=` should curl this and
 * restart the service on 503. Returns:
 *  - 503 when the event loop has been blocked &gt;5s (max delay observed in the
 *    sampling window since the last probe). Indicates a wedged sync hot path
 *    or an unresponsive process — better to restart than limp.
 *  - 200 with concurrency stats otherwise.
 */
import { json, type RequestHandler } from '@sveltejs/kit';
import { getRuntimeStats, readEventLoopMaxMs } from '$lib/workflows/engine-runtime';

const MAX_LOOP_DELAY_MS = 5000;

export const GET: RequestHandler = async () => {
  const loopMaxMs = readEventLoopMaxMs();
  const stats = getRuntimeStats();
  const ok = loopMaxMs < MAX_LOOP_DELAY_MS;
  return json(
    {
      ok,
      loopMaxMs,
      loopThresholdMs: MAX_LOOP_DELAY_MS,
      ...stats,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
};
