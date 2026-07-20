// Model-routing scheduler. Mirrors the briefing/self-improve engines: ensure the
// collections on boot (host-agnostic), schedule the nightly cron only in
// production (hostname !== 'homeserv' unless ROUTING_ALLOW_DEV=1), re-check the
// kill switch in the cron callback. Never throws into croner.
import { Cron } from 'croner';
import os from 'os';
import { getSetting } from '$lib/server/models/settings';
import { runSelectionNow } from './run';
import { ensureRoutingCollections } from './events';
import { CRON_EXPR, CRON_TZ, SETTINGS_ENABLED_KEY, errMsg } from './types';

let cronJob: Cron | null = null;
let started = false;

export function isRoutingScheduled(): boolean {
  return cronJob !== null;
}

export function startModelRouting(): void {
  if (started) return;
  started = true;

  void ensureRoutingCollections().catch((err) =>
    console.error('[routing] ensure collections failed:', errMsg(err)),
  );

  const host = os.hostname();
  if (host === 'homeserv' && process.env.ROUTING_ALLOW_DEV !== '1') {
    console.log('[routing] host is homeserv — nightly cron disabled. Set ROUTING_ALLOW_DEV=1 to enable locally.');
    return;
  }

  try {
    cronJob = new Cron(CRON_EXPR, { timezone: CRON_TZ }, () => {
      void fireCron();
    });
    console.log(`[routing] nightly model selection scheduled (${CRON_EXPR} ${CRON_TZ})`);
  } catch (err) {
    console.error('[routing] failed to schedule cron:', errMsg(err));
  }
}

async function fireCron(): Promise<void> {
  try {
    const enabled = await getSetting<boolean>(SETTINGS_ENABLED_KEY);
    if (enabled === false) {
      console.log('[routing] kill switch is off — skipping nightly selection');
      return;
    }
    await runSelectionNow({ trigger: 'cron' });
  } catch (err) {
    console.error('[routing] cron fire skipped/failed:', errMsg(err));
  }
}

export function stopModelRouting(): void {
  if (cronJob) cronJob.stop();
  cronJob = null;
  started = false;
}
