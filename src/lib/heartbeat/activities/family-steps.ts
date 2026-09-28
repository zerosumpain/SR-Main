import { errMsg } from '$lib/home/presence/types';
import { pushStandings, refreshAndCheck, standingsDone } from '$lib/family/steps.server';
import type { ActivityHandler } from '../types';

/**
 * The family steps board's poll: every 15 minutes through the day, each family
 * member on the iPhone app has today's count read from the pilot and stored,
 * and whoever was knocked off the top hears about it (at most twice a day, and
 * never on the day's first poll). No LLM.
 */
export const familySteps: ActivityHandler = {
  name: 'family-steps',
  description:
    "Reads each family member's steps from the iPhone app's pilot every 15 min (08:00–21:00 London), stores the day's board, and pushes whoever lost the top spot (max 2/day). No LLM.",
  defaultCadenceSeconds: 900,
  defaultEnabled: true,
  defaultActiveHours: { start: '08:00', end: '21:00', tz: 'Europe/London' },
  defaultConfig: {},

  async run(ctx) {
    try {
      const r = await refreshAndCheck(new Date(ctx.now));
      const bits = [`${r.day}: ${r.written}/${r.asked} counted`];
      if (r.failed) bits.push(`${r.failed} unreachable`);
      if (r.pushed) bits.push('top spot changed, pushed');
      const outcome = r.asked > 0 && r.failed === r.asked ? 'error' : 'ok';
      return { outcome, summary: bits.join(' · '), details: { ...r } };
    } catch (err) {
      return { outcome: 'error', summary: `failed: ${errMsg(err).slice(0, 160)}` };
    }
  },
};

/**
 * The 4pm standings: refresh, then push everyone on the board their place.
 * Runs every 15 minutes inside a half-hour window so one missed tick does not
 * lose the day; the one-per-person-per-day event makes the second run a no-op.
 */
export const familySteps4pm: ActivityHandler = {
  name: 'family-steps-4pm',
  description:
    "Pushes everyone on the family steps board their place at 4pm London (once per person per day; skipped under two people). No LLM.",
  defaultCadenceSeconds: 900,
  defaultEnabled: true,
  defaultActiveHours: { start: '16:00', end: '16:30', tz: 'Europe/London' },
  defaultConfig: {},

  async run(ctx) {
    const now = new Date(ctx.now);
    try {
      if (await standingsDone(now)) return { outcome: 'skipped', summary: 'already sent today' };
      const r = await pushStandings(now);
      const summary = r.skipped ? `${r.day}: ${r.skipped}` : `${r.day}: ${r.pushed} of ${r.board} pushed`;
      return { outcome: r.skipped ? 'skipped' : 'ok', summary, details: { ...r } };
    } catch (err) {
      return { outcome: 'error', summary: `failed: ${errMsg(err).slice(0, 160)}` };
    }
  },
};
