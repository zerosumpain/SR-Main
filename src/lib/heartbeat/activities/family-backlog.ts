import { errMsg } from '$lib/home/presence/types';
import { runDigest } from '$lib/family/backlog.server';
import type { ActivityHandler } from '../types';

/**
 * The family backlog's evening round-up: once a London day, everyone who
 * turned it on (the Backlog page's switch) hears what others added in the
 * last 24 hours that is still on the list. Every 15 minutes inside a
 * half-hour window, so one missed tick does not lose the evening; each person
 * is claimed for the day before anything is sent. No LLM.
 */
export const familyBacklogDigest: ActivityHandler = {
  name: 'family-backlog-digest',
  description:
    "Pushes the family backlog's evening round-up (what others added in 24 h, still on the list) at 7pm London to those who turned it on, once per person per day. No LLM.",
  defaultCadenceSeconds: 900,
  defaultEnabled: true,
  defaultActiveHours: { start: '19:00', end: '19:30', tz: 'Europe/London' },
  defaultConfig: {},

  async run(ctx) {
    try {
      const r = await runDigest(new Date(ctx.now));
      if (!r.claimed) return { outcome: 'skipped', summary: r.wanted ? `${r.day}: already sent` : `${r.day}: nobody has it on` };
      return { outcome: 'ok', summary: `${r.day}: ${r.pushed} of ${r.claimed} pushed`, details: { ...r } };
    } catch (err) {
      return { outcome: 'error', summary: `failed: ${errMsg(err).slice(0, 160)}` };
    }
  },
};
