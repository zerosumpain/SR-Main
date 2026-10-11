import { getSetting } from '$lib/server/models/settings';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import { SWEEP_GRACE_DAYS } from '$lib/daydream/think/shelf';
import type { ActivityHandler } from '../types';

/**
 * Files daydream notes that have been flagged "Probably past its date" for
 * more than a week with no answer (`think/shelf.ts` `sweepDue`). The same
 * read as the Inbox and the same `expired` status as his "File it", under its
 * own reason so its filings can be told apart and put back. Idempotent, so a
 * missed tick costs nothing. No LLM.
 */
export const daydreamStaleSweep: ActivityHandler = {
  name: 'daydream-stale-sweep',
  description: `Files daydream notes left flagged "past its date" and unanswered for more than ${SWEEP_GRACE_DAYS} days (status expired, reason "filed automatically"). Never touches a note he has answered. No LLM.`,
  defaultCadenceSeconds: 6 * 3600,
  defaultEnabled: true,
  defaultConfig: {},

  async run(ctx) {
    // Paused daydreaming pauses its housekeeping too: nothing moves while he
    // has it off.
    if ((await getSetting<boolean>(SETTINGS_ENABLED_KEY)) === false) {
      return { outcome: 'skipped', summary: 'daydreaming disabled' };
    }
    try {
      const { sweepStale } = await import('$lib/daydream/think/notes.server');
      const r = await sweepStale(new Date(ctx.now));
      if (r.filed === 0) return { outcome: 'skipped', summary: `nothing due (${r.flagged} flagged)`, details: { ...r } };
      return { outcome: 'ok', summary: `filed ${r.filed} of ${r.flagged} flagged`, details: { ...r } };
    } catch (err) {
      return { outcome: 'error', summary: `failed: ${errMsg(err).slice(0, 160)}` };
    }
  },
};
