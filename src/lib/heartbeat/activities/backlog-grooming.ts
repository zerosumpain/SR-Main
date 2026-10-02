import { autoGroomBacklog } from '$lib/selfimprove/backlog-room.server';
import type { ActivityHandler } from '../types';

/**
 * The backlog room's automatic grooming, off the page GET.
 *
 * Until 2026-10-02 every owner view of /jkai/develop/backlog ran
 * `autoGroomBacklog` inside its load: it saved epic memberships and applied
 * every automatic merge before drawing the room, so a page view was a write.
 * The same pass runs here instead, on its own cadence, plus after every intake
 * (`groomAfterIntake`) and in the nightly run's gather phase as before. The
 * advisory lock it takes keeps the three from racing each other or an owner's
 * decision.
 *
 * No LLM and no budget, so no idle gate: it is a deterministic fold over the
 * ledgers. Ten minutes is the latency an arrival's automatic merge can now
 * wait — the page shows the suggestion in the meantime.
 */
export const backlogGrooming: ActivityHandler = {
  name: 'backlog-grooming',
  description:
    'Reconciles improvement-backlog epics with their deliverables and applies the automatic grooming decisions (twin merges and covered requests), under the advisory lock the intake and the owner share. No LLM.',
  defaultCadenceSeconds: 600,
  defaultEnabled: true,
  defaultConfig: {},

  async run() {
    const { epics, applied } = await autoGroomBacklog();
    const pending = epics.reduce((n, e) => n + (e.suggestions?.length ?? 0), 0);
    return {
      outcome: 'ok',
      summary: `${epics.length} epic(s) reconciled; ${applied} automatic decision(s) applied; ${pending} suggestion(s) for the owner`,
      details: { epics: epics.length, applied, pending },
    };
  },
};
