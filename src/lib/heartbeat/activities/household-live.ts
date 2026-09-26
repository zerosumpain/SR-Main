import { errMsg } from '$lib/home/presence/types';
import { ingestCompanion, type CompanionResult } from '$lib/home/presence/companion';
import { listMembers, type HouseholdMember } from '$lib/home/presence/members';
import { pushAppViews } from '$lib/home/presence/app-view';
import type { ActivityHandler } from '../types';

/** A view is rebuilt at least this often even when no app fix arrived, so a
 *  Life360 member's move (written by `daydream-observe`) still reaches it. */
export const VIEW_REFRESH_S = 110;

let lastPush = 0;

/** Reset between tests. */
export function resetHouseholdLive(): void {
  lastPush = 0;
}

/**
 * The iPhone app's side of the household, every 30 seconds (the engine's
 * tick, so the fastest anything here can run).
 *
 * Pulls the app's fixes from the pilot, and when anything new arrived — or
 * two minutes have passed — rebuilds everyone's Family view and files it
 * back. That is what makes the Family tab near-live while somebody is out on
 * close tracking: phone → pilot within 30 s, pilot → trail → view within the
 * next tick.
 *
 * The ONLY caller of `ingestCompanion` and `pushAppViews`. Both used to run
 * inside `daydream-observe`; two activities pulling the same cursor would
 * write the same fixes twice (the engine runs different activities
 * concurrently, and the trail has no unique index).
 *
 * No LLM. A quiet run is one loopback GET to the pilot.
 */
export const householdLive: ActivityHandler = {
  name: 'household-live',
  description:
    "Pulls the iPhone app's fixes from the pilot every 30 s and, when anything arrived (or every two minutes), rebuilds and files each app user's Family view. No LLM.",
  defaultCadenceSeconds: 30,
  defaultEnabled: true,
  defaultConfig: {},

  async run() {
    let members: HouseholdMember[];
    try {
      members = await listMembers();
    } catch (err) {
      return { outcome: 'ok', summary: `members unreadable: ${errMsg(err).slice(0, 120)}` };
    }

    const bits: string[] = [];
    const details: Record<string, unknown> = {};
    let companion: CompanionResult | null = null;
    try {
      companion = await ingestCompanion(members);
    } catch (err) {
      companion = { pages: 0, written: 0, dropped: 0, rejected: 0, skipped: 0, more: false, error: errMsg(err) };
    }
    if (companion) {
      details.companion = companion;
      const c = [`${companion.written} written`];
      if (companion.thinned) c.push(`${companion.thinned} thinned`);
      if (companion.dropped) c.push(`${companion.dropped} unmapped`);
      if (companion.rejected) c.push(`${companion.rejected} rejected`);
      if (companion.more) c.push('more waiting');
      if (companion.error) c.push(`failed: ${companion.error.slice(0, 80)}`);
      bits.push(`companion: ${c.join(', ')}`);
    }

    const due = (companion?.written ?? 0) > 0 || Date.now() - lastPush >= VIEW_REFRESH_S * 1000;
    if (due) {
      try {
        const views = await pushAppViews(members);
        if (views) {
          details.appViews = views;
          if (!views.error) lastPush = Date.now();
          const v = [`${views.stored} stored`];
          if (views.refused) v.push(`${views.refused} not in the Family Circle`);
          if (views.error) v.push(`failed: ${views.error.slice(0, 80)}`);
          bits.push(`app views: ${v.join(', ')}`);
        }
      } catch (err) {
        details.appViewsError = errMsg(err).slice(0, 200);
        bits.push(`app views failed: ${errMsg(err).slice(0, 80)}`);
      }
    }

    return { outcome: 'ok', summary: bits.join(' · ') || 'nothing new', details };
  },
};
