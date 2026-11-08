import { runNightlyRouting } from '$lib/routing/engine';
import { SCHEDULE_WINDOW } from '$lib/routing/types';
import type { ActivityHandler } from '../types';

/**
 * The nightly model selection, on the heartbeat instead of a 04:00 croner.
 * Daily, in a window that opens at 04:00 London — after the self-improvement
 * window closes, before the morning briefing — so it lands where it did. The
 * host gate and the kill switch are checked by `runNightlyRouting`, as the
 * croner checked them at fire time. No idle gate: the croner had none, and the
 * selection is what the next day's chat routing reads.
 */
export const modelRouting: ActivityHandler = {
  name: 'model-routing',
  description:
    'Nightly model selection: refreshes the catalogue and re-picks the model for each routing profile from measured success and price. Advisory pins and the kill switch (jkai.routing.enabled) are respected.',
  defaultCadenceSeconds: 86_400,
  defaultEnabled: true,
  defaultActiveHours: { ...SCHEDULE_WINDOW },
  defaultConfig: {},

  async run() {
    try {
      const result = await runNightlyRouting();
      if (!result.ran) return { outcome: 'skipped', summary: result.reason };
      return { outcome: result.status === 'failed' ? 'error' : 'ok', summary: `selection ${result.runId.slice(0, 8)} ${result.status}`, details: { ...result } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A manual "Re-select now" in progress is a skip, not a fault.
      if (/already running/i.test(msg)) return { outcome: 'skipped', summary: 'a selection is already running' };
      return { outcome: 'error', summary: msg.slice(0, 200) };
    }
  },
};
