import { DRIFT_WINDOW, runMonthlyDriftCheck } from '$lib/voice/drift-engine';
import type { ActivityHandler } from '../types';

/**
 * The monthly voice drift check, on the heartbeat instead of a croner that
 * fired at 06:00 London on the 1st. The heartbeat has no monthly cadence, so
 * this looks once a day in the same window and acts only on the 1st; on every
 * other day it reports a skip and spends nothing. Advisory only: it writes a
 * note when the corpus has materially drifted from the committed Voice Card.
 */
export const voiceDrift: ActivityHandler = {
  name: 'voice-drift',
  description:
    'Monthly, on the 1st: measures the published corpus against the committed Voice Card and records a note when it has materially drifted. Changes nothing else. No LLM.',
  defaultCadenceSeconds: 86_400,
  defaultEnabled: true,
  defaultActiveHours: { ...DRIFT_WINDOW },
  defaultConfig: {},

  async run(ctx) {
    const result = await runMonthlyDriftCheck(new Date(ctx.now));
    if (!result.ran) return { outcome: 'skipped', summary: result.reason };
    if (!result.report) return { outcome: 'ok', summary: 'no Voice Card built — nothing to compare against' };
    return { outcome: 'ok', summary: result.report.summary.slice(0, 200), details: { material: result.report.material } };
  },
};
