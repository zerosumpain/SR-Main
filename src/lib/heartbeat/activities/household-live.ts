import { errMsg } from '$lib/home/presence/types';
import { ingestCompanion, loadCompanionUsers, type CompanionResult } from '$lib/home/presence/companion';
import { listMembers, type HouseholdMember } from '$lib/home/presence/members';
import { pushAppViews } from '$lib/home/presence/app-view';
import { deliverAlerts, runCrossings } from '$lib/home/presence/alerts';
import { runLiveJourneys } from '$lib/home/presence/live-journey';
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
 * Also the only runner of arrivals and departures (`runCrossings` →
 * `deliverAlerts`), the Lock Screen journeys and the low-battery alert,
 * straight after the pull: a crossing is pushed within one tick of the fix
 * that made it, where `daydream-observe`'s 120 s cadence used to add up to
 * two minutes (review 2026-11-09). The crossings read the whole trail, so
 * Life360 fixes written by observe are seen on the next tick here.
 *
 * No LLM. A quiet run is one loopback GET to the pilot.
 */
export const householdLive: ActivityHandler = {
  name: 'household-live',
  description:
    "Pulls the iPhone app's fixes from the pilot every 30 s, raises and delivers arrive/leave alerts (and low battery, and Lock Screen journeys) from them, and, when anything arrived (or every two minutes), rebuilds and files each app user's Family view. No LLM.",
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

    // Accounts deleted from a phone paired to the pilot alone: finish them
    // off here (their site account, data, household link, then the pilot row).
    try {
      const { sweepAccountDeletions } = await import('$lib/people/erase');
      const swept = await sweepAccountDeletions(await loadCompanionUsers());
      if (swept.deleted || swept.failed) {
        details.accountDeletions = swept;
        bits.push(`accounts deleted: ${swept.deleted}${swept.failed ? `, ${swept.failed} failed` : ''}`);
      }
    } catch (err) {
      details.accountDeletionsError = errMsg(err).slice(0, 160);
    }

    await runAlerts(members, bits, details);

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

    try {
      const { discoverRecentStops } = await import('$lib/home/presence/stops.server');
      details.stops = await discoverRecentStops();
    } catch (err) { details.stopsError = errMsg(err).slice(0, 160); }
    try {
      const { deliverArrivalEstimates } = await import('$lib/home/presence/eta-alerts.server');
      details.arrivals = await deliverArrivalEstimates();
    } catch (err) { details.arrivalsError = errMsg(err).slice(0, 160); }

    return { outcome: 'ok', summary: bits.join(' · ') || 'nothing new', details };
  },
};

/**
 * Arrivals and departures from every trail row written since the last run,
 * then their delivery, then the Lock Screen journeys they start, end or move,
 * then low battery. None of it can fail the run: an alert that did not go stays
 * owed and is retried while it is under two hours old.
 */
async function runAlerts(members: HouseholdMember[], bits: string[], details: Record<string, unknown>): Promise<void> {
  try {
    const crossings = await runCrossings(members);
    details.crossings = crossings;
    const c: string[] = [];
    if (crossings.written) c.push(`${crossings.written} new`);
    if (crossings.deduped) c.push(`${crossings.deduped} repeated`);
    if (crossings.initialised.length) c.push(`started watching ${crossings.initialised.join(', ')}`);
    if (crossings.errors.length) c.push(`failed: ${crossings.errors.join('; ').slice(0, 120)}`);
    if (c.length) bits.push(`crossings: ${c.join(', ')}`);
  } catch (err) {
    details.crossingsError = errMsg(err).slice(0, 200);
    bits.push(`crossings failed: ${errMsg(err).slice(0, 80)}`);
  }
  try {
    const sent = await deliverAlerts(members);
    details.alerts = sent;
    const a: string[] = [];
    if (sent.pushed) a.push(`${sent.pushed} pushed`);
    if (sent.forwarded) a.push(`${sent.forwarded} to the app`);
    if (sent.pilotError) a.push(`app queue failed: ${sent.pilotError.slice(0, 80)}`);
    if (sent.whatsappSent.length) a.push(`WhatsApp to ${sent.whatsappSent.join(', ')}`);
    if (sent.whatsappFailed.length) a.push(`WhatsApp failed to ${sent.whatsappFailed.join(', ')}`);
    if (a.length) bits.push(`alerts: ${a.join(', ')}`);
  } catch (err) {
    details.alertsError = errMsg(err).slice(0, 200);
    bits.push(`alerts failed: ${errMsg(err).slice(0, 80)}`);
  }
  try {
    const live = await runLiveJourneys(members);
    details.liveJourneys = live;
    const l: string[] = [];
    if (live.started) l.push(`${live.started} started`);
    if (live.updated) l.push(`${live.updated} moved`);
    if (live.ended) l.push(`${live.ended} ended`);
    if (live.errors.length) l.push(`failed: ${live.errors.join('; ').slice(0, 120)}`);
    if (l.length) bits.push(`journeys: ${l.join(', ')}`);
  } catch (err) {
    details.liveJourneysError = errMsg(err).slice(0, 200);
  }
  try {
    const { deliverBatteryAlerts } = await import('$lib/home/presence/battery-alerts.server');
    const battery = await deliverBatteryAlerts(members);
    if (battery.sent || battery.errors.length) details.battery = battery;
    if (battery.sent) bits.push(`low battery: ${battery.sent} told`);
  } catch (err) {
    details.batteryError = errMsg(err).slice(0, 160);
  }
  // Lights daydream turned off in an empty house come back on when someone is
  // home (`daydream/act/standing.server.ts`). Here because this is the tick
  // that learns of an arrival; a quiet call is one small read a minute.
  try {
    const { restoreAwayLights } = await import('$lib/daydream/act/standing.server');
    const lights = await restoreAwayLights();
    if (lights.restored || lights.dropped) details.awayLights = lights;
    if (lights.restored) bits.push(`lights back on: ${lights.restored} note${lights.restored === 1 ? '' : 's'}`);
  } catch (err) {
    details.awayLightsError = errMsg(err).slice(0, 160);
  }
}
